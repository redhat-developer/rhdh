import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import * as yaml from "yaml";

import {
  cloudSqlDatabasePrefix,
  readCloudSqlInputs,
  isCloudSqlRevisionReady,
  buildCloudSqlProxy,
  buildCloudSqlEgressPolicy,
} from "../playwright/utils/cloudsql-config";
import { buildImageRef } from "../playwright/utils/helper";
import { isRecord } from "../playwright/utils/kube-client";
import {
  generateAppConfigYaml,
  generateBackstageCR,
  generateHelmValuesYaml,
  generateHelmSetArgs,
  generateDynamicPluginsYaml,
  type RuntimeDeployConfig,
} from "../playwright/utils/runtime-config";

mkdirSync(join(tmpdir(), "opencode"), { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(tmpdir(), "opencode", "cloudsql-unit-"));
const keyPath = join(directory, "key.json");
writeFileSync(
  keyPath,
  JSON.stringify({
    type: "service_account",
    client_email: "test@example.test",
    private_key: "fake key",
  }),
  { mode: 0o600 },
);
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const env = {
  CLOUDSQL_USER: "test-user",
  CLOUDSQL_PASSWORD: "test-password",
  CLOUDSQL_INSTANCE_1: "project:region:instance",
  CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH: keyPath,
};
const config: RuntimeDeployConfig = {
  releaseName: "rhdh",
  namespace: "runtime-cloudsql",
  routerBase: "apps.example.test",
  image: buildImageRef("quay.io", "rhdh-community/rhdh", "next"),
  internalPostgresqlImage: buildImageRef("quay.io", "fedora/postgresql-18", "latest"),
  cloudSql: {
    instanceConnectionName: "project:region:instance",
    user: "test-user",
    databasePrefix: cloudSqlDatabasePrefix("012345abcdef", 1),
    revision: "test-revision",
  },
};

describe("Cloud SQL prerequisites", () => {
  it("only skips an unconfigured optional run", () => {
    expect(readCloudSqlInputs({})).toBeNull();
    expect(() => readCloudSqlInputs({ CLOUDSQL_REQUIRED: "true" })).toThrow(
      "requires CLOUDSQL_INSTANCE_1..4",
    );
    expect(() => readCloudSqlInputs({ CLOUDSQL_INSTANCE_1: env.CLOUDSQL_INSTANCE_1 })).toThrow(
      "require CLOUDSQL_USER",
    );
  });
  it("rejects incomplete required coverage but accepts all four configured slots", () => {
    expect(() => readCloudSqlInputs({ ...env, CLOUDSQL_REQUIRED: "true" })).toThrow(
      "requires CLOUDSQL_INSTANCE_1..4",
    );
    const inputs = readCloudSqlInputs({
      ...env,
      CLOUDSQL_REQUIRED: "true",
      CLOUDSQL_INSTANCE_2: "p:r:i2",
      CLOUDSQL_INSTANCE_3: "p:r:i3",
      CLOUDSQL_INSTANCE_4: "p:r:i4",
    });
    expect(inputs?.instances).toHaveLength(4);
  });
  it("rejects malformed instance names and service accounts without leaking JSON", () => {
    expect(() => readCloudSqlInputs({ ...env, CLOUDSQL_INSTANCE_1: "invalid" })).toThrow(
      "project:region:instance",
    );
    const broken = join(directory, "broken.json");
    writeFileSync(broken, "secret-fragment", { mode: 0o600 });
    expect(() =>
      readCloudSqlInputs({ ...env, CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH: broken }),
    ).toThrow("readable service-account JSON key");
  });
  it("uses distinct bounded prefixes for runs and slots and rejects unsafe ownership", () => {
    expect(cloudSqlDatabasePrefix("012345abcdef", 1)).not.toBe(
      cloudSqlDatabasePrefix("012345abcdef", 2),
    );
    expect(cloudSqlDatabasePrefix("012345abcdef", 1)).not.toBe(
      cloudSqlDatabasePrefix("abcdef012345", 1),
    );
    expect(() => cloudSqlDatabasePrefix("anything", 1)).toThrow("ownership");
    expect(() => cloudSqlDatabasePrefix("012345abcdef", 5)).toThrow("ownership");
  });
});

describe("Operator Cloud SQL configuration", () => {
  it("supplies the same sign-in/homepage modules as Helm and permits the proxy's actual DB port", () => {
    expect(yaml.parse(generateDynamicPluginsYaml(config))).toMatchObject({
      includes: ["dynamic-plugins.default.yaml"],
    });
    expect(buildCloudSqlEgressPolicy("backstage-rhdh")).toMatchObject({
      spec: {
        podSelector: { matchLabels: { "rhdh.redhat.com/app": "backstage-rhdh" } },
        policyTypes: ["Egress"],
        egress: [{ ports: [{ port: 3307, protocol: "TCP" }] }],
      },
    });
  });
  it("rejects a ready old revision until reconciliation and rollout finish", () => {
    const cloudSql = config.cloudSql!;
    const deployment = {
      metadata: { generation: 2 },
      spec: {
        replicas: 1,
        selector: {},
        template: {
          metadata: { annotations: { "rhdh.redhat.com/cloudsql-revision": cloudSql.revision } },
          spec: {
            containers: [],
            initContainers: [buildCloudSqlProxy(cloudSql.instanceConnectionName)],
          },
        },
      },
      status: {
        observedGeneration: 1,
        readyReplicas: 1,
        availableReplicas: 1,
        updatedReplicas: 1,
        replicas: 1,
      },
    };
    expect(isCloudSqlRevisionReady(deployment, cloudSql)).toBe(false);
    deployment.status.observedGeneration = 2;
    deployment.status.updatedReplicas = 0;
    expect(isCloudSqlRevisionReady(deployment, cloudSql)).toBe(false);
    deployment.status.updatedReplicas = 1;
    deployment.status.replicas = 2;
    expect(isCloudSqlRevisionReady(deployment, cloudSql)).toBe(false);
    deployment.status.replicas = 1;
    expect(isCloudSqlRevisionReady(deployment, cloudSql)).toBe(true);
    deployment.spec.template.spec.initContainers = [buildCloudSqlProxy("another:region:instance")];
    expect(isCloudSqlRevisionReady(deployment, cloudSql)).toBe(false);
  });
  it("owns external DB credentials and orders the native proxy before the localhost wait", () => {
    const proxyArgs: unknown = expect.arrayContaining(["project:region:instance"]);
    const waitCommand: unknown = expect.stringContaining("/dev/tcp/127.0.0.1/5432");
    const waitCommands: unknown = expect.arrayContaining([waitCommand]);
    const home: unknown = expect.arrayContaining([{ "page:home": { config: { path: "/" } } }]);
    expect(generateBackstageCR(config)).toMatchObject({
      metadata: { annotations: { "rhdh.redhat.com/deployment-patch-list-merge-mode": "prepend" } },
      spec: {
        database: { enableLocalDb: false, authSecretName: "cloud-sql-database" },
        application: {
          extraEnvs: {
            secrets: [
              { name: "rhdh-runtime-config" },
              {
                name: "cloud-sql-database",
                key: "CLOUDSQL_API_TOKEN",
                containers: ["backstage-backend"],
              },
            ],
          },
        },
        deployment: {
          patch: {
            spec: {
              template: {
                metadata: { annotations: { "rhdh.redhat.com/cloudsql-revision": "test-revision" } },
                spec: {
                  initContainers: [
                    {
                      name: "cloud-sql-proxy",
                      restartPolicy: "Always",
                      args: proxyArgs,
                    },
                    { name: "install-dynamic-plugins" },
                    {
                      name: "wait-for-db",
                      command: waitCommands,
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    expect(yaml.parse(generateAppConfigYaml("https://runtime.example.test", config))).toMatchObject(
      {
        app: { extensions: home },
        backend: { database: { prefix: "csql_012345abcdef_1_", connection: { ssl: false } } },
      },
    );
  });
});

// Opt-in render against the actual CI-selected OCI archive, not a copied template.
it.skipIf(process.env.CLOUDSQL_CHART_ARCHIVE === undefined)(
  "renders the standalone chart with a declarative proxy and no bundled DB",
  () => {
    const valuesPath = join(directory, "values.yaml");
    writeFileSync(valuesPath, generateHelmValuesYaml(config), { mode: 0o600 });
    const rendered = execFileSync(
      "helm",
      [
        "template",
        "rhdh",
        process.env.CLOUDSQL_CHART_ARCHIVE!,
        "-n",
        config.namespace,
        "-f",
        valuesPath,
        "--set",
        "openshift.clusterRouterBase=apps.example.test",
        ...generateHelmSetArgs(config),
      ],
      { encoding: "utf8" },
    );
    const documents = yaml.parseAllDocuments(rendered).map((document) => {
      const value: unknown = document.toJSON();
      return value;
    });
    const deployment = documents.find(
      (document) => isRecord(document) && document.kind === "Deployment",
    );
    const backendSecret: unknown = expect.any(Object);
    const envVars: unknown = expect.arrayContaining([
      { name: "POSTGRES_HOST", value: "127.0.0.1" },
      {
        name: "POSTGRES_PASSWORD",
        valueFrom: { secretKeyRef: { name: "cloud-sql-database", key: "POSTGRES_PASSWORD" } },
      },
      { name: "BACKEND_SECRET", valueFrom: backendSecret },
    ]);
    expect(deployment).toMatchObject({
      spec: {
        template: {
          spec: {
            initContainers: [
              { name: "cloud-sql-proxy", restartPolicy: "Always" },
              { name: "install-dynamic-plugins" },
              { name: "wait-for-db" },
            ],
            containers: [
              {
                name: "backstage-backend",
                env: envVars,
              },
              { name: "cloud-sql-entity" },
            ],
          },
        },
      },
    });
    expect(
      documents.some((document) => isRecord(document) && document.kind === "StatefulSet"),
    ).toBe(false);
    expect(rendered).not.toContain("upstream:");
  },
);
