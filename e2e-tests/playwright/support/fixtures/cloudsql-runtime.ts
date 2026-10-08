/* oxlint-disable import/max-dependencies -- coordinates deployment, SQL, diagnostics and Playwright lifecycle */
import { randomBytes } from "node:crypto";

import type { TestInfo } from "@playwright/test";
import * as yaml from "yaml";

import {
  CLOUD_SQL_DB_SECRET,
  CLOUD_SQL_SA_SECRET,
  cloudSqlDatabasePrefix,
  readCloudSqlInputs,
  isNonEmptyString,
} from "../../utils/cloudsql-config";
import { CloudSqlDatabaseSession, clearCloudSqlDatabases } from "../../utils/cloudsql-database";
import { base64Encode, discoverRouterBase, resolveInstallMethod, run } from "../../utils/helper";
import { KubeClient, getErrorStatusCode, getRhdhDeploymentName } from "../../utils/kube-client";
import { pollUntil } from "../../utils/poll-until";
import { resolveConfig, type RuntimeDeployConfig } from "../../utils/runtime-config";
import { deployRuntime, type RuntimeDeploymentHandle } from "../../utils/runtime-deploy";
import { stopRuntimeApplication } from "../../utils/runtime-lifecycle";
import { test as base } from "../coverage/test";

type CloudSqlRuntime = RuntimeDeploymentHandle & {
  databasePrefix: string;
  entityName: string;
  apiToken: string;
  sql: CloudSqlDatabaseSession;
  restart(): Promise<void>;
};

const ownerLabel = "rhdh.redhat.com/cloudsql-run";

/** Bounded namespace deletion also stops writers left by an interrupted worker. */
async function deleteOwnedNamespace(
  kube: KubeClient,
  namespace: string,
  runId: string,
): Promise<void> {
  try {
    const existing = await kube.coreV1Api.readNamespace(namespace);
    if (existing.body.metadata?.labels?.[ownerLabel] !== runId) {
      throw new Error(`Refusing to delete unowned namespace ${namespace}`);
    }
    await kube.coreV1Api.deleteNamespace(namespace);
  } catch (error) {
    if (getErrorStatusCode(error) === 404) return;
    throw error;
  }
  await pollUntil(
    async () => {
      try {
        await kube.coreV1Api.readNamespace(namespace);
        return false;
      } catch (error) {
        if (getErrorStatusCode(error) === 404) return true;
        throw error;
      }
    },
    { timeoutMs: 180_000, intervalMs: 2_000, label: `Namespace ${namespace} deletion` },
  );
}

async function stopApplication(
  config: RuntimeDeployConfig,
  installMethod: "helm" | "operator",
  kube: KubeClient,
): Promise<void> {
  const { namespace, releaseName } = config;
  if (installMethod === "helm") {
    await run(
      "helm",
      ["uninstall", releaseName, "-n", namespace, "--ignore-not-found", "--wait", "--timeout=3m"],
      { timeout: 210_000 },
    );
  } else {
    await run(
      "oc",
      [
        "delete",
        `backstages.rhdh.redhat.com/${releaseName}`,
        "-n",
        namespace,
        "--ignore-not-found",
        "--cascade=foreground",
        "--wait=true",
        "--timeout=180s",
      ],
      { timeout: 210_000 },
    );
  }
  // Also handles a partially-created deployment after failed installation.
  await run(
    "oc",
    [
      "delete",
      `deployment/${getRhdhDeploymentName(installMethod, releaseName)}`,
      "-n",
      namespace,
      "--ignore-not-found",
      "--cascade=foreground",
      "--wait=true",
      "--timeout=180s",
    ],
    { timeout: 210_000 },
  );
  await pollUntil(
    async () => {
      const pods = await kube.coreV1Api.listNamespacedPod(namespace);
      return pods.body.items.every((pod) => pod.metadata?.name === "cloud-sql-cleanup");
    },
    {
      timeoutMs: 180_000,
      intervalMs: 2_000,
      label: "Cloud SQL application pods terminated before SQL cleanup",
    },
  );
}

async function collectDiagnostics(
  kube: KubeClient,
  namespace: string,
  testInfo: TestInfo,
  redact: (text: string) => string,
): Promise<void> {
  const attach = async (name: string, action: () => Promise<unknown>) => {
    try {
      const result = await action();
      await testInfo.attach(name, {
        body: redact(typeof result === "string" ? result : JSON.stringify(result, null, 2)),
        contentType: "text/plain",
      });
    } catch (error) {
      console.warn(`Cloud SQL diagnostic ${name} unavailable: ${redact(String(error))}`);
    }
  };
  await attach(
    "cloudsql-deployments",
    async () => (await kube.appsApi.listNamespacedDeployment(namespace)).body,
  );
  await attach(
    "cloudsql-events",
    async () => (await kube.coreV1Api.listNamespacedEvent(namespace)).body,
  );
  await attach(
    "cloudsql-pods",
    async () => (await kube.coreV1Api.listNamespacedPod(namespace)).body,
  );
  try {
    const pods = await kube.coreV1Api.listNamespacedPod(namespace);
    for (const pod of pods.body.items) {
      const name = pod.metadata?.name;
      if (!isNonEmptyString(name)) continue;
      for (const container of [
        ...(pod.spec?.initContainers ?? []),
        ...(pod.spec?.containers ?? []),
      ]) {
        await attach(`${name}-${container.name}`, () =>
          run("oc", ["logs", "-n", namespace, name, "-c", container.name, "--tail=500"], {
            timeout: 30_000,
          }),
        );
      }
    }
  } catch (error) {
    console.warn(`Cloud SQL pod logs unavailable: ${redact(String(error))}`);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = base.extend<{ cloudSqlSlot: number; cloudSqlRuntime: CloudSqlRuntime }>({
  cloudSqlSlot: [1, { option: true }],
  baseURL: async ({ cloudSqlRuntime }, use) => {
    await use(cloudSqlRuntime.baseURL);
  },
  cloudSqlRuntime: [
    async ({ cloudSqlSlot }, use, testInfo) => {
      const inputs = readCloudSqlInputs();
      testInfo.skip(inputs === null, "No Cloud SQL instances configured (optional local coverage)");
      if (!inputs) return;
      const instance = inputs.instances[cloudSqlSlot - 1];
      testInfo.skip(instance === undefined, `CLOUDSQL_INSTANCE_${cloudSqlSlot} not configured`);
      if (instance === undefined) return;
      const runId = process.env.CLOUDSQL_RUN_ID ?? "";
      const databasePrefix = cloudSqlDatabasePrefix(runId, cloudSqlSlot);
      if (
        !isNonEmptyString(process.env.K8S_CLUSTER_URL) ||
        !isNonEmptyString(process.env.K8S_CLUSTER_TOKEN)
      ) {
        throw new Error(
          "Cloud SQL runtime requires K8S_CLUSTER_URL and K8S_CLUSTER_TOKEN from the normal E2E setup",
        );
      }
      const installMethod = resolveInstallMethod();
      const config = resolveConfig(await discoverRouterBase());
      if (installMethod === "helm" && !config.helm)
        throw new Error("Cloud SQL Helm runtime requires CHART_VERSION");
      config.namespace = `${config.namespace.slice(0, 20).replace(/-+$/u, "")}-csql-${runId}`;
      config.cloudSql = {
        instanceConnectionName: instance,
        user: inputs.user,
        databasePrefix,
        revision: randomBytes(8).toString("hex"),
      };
      const entityName = `cloudsql-${runId}-${cloudSqlSlot}`;
      const apiToken = randomBytes(32).toString("hex");
      const redact = (text: string) =>
        text.replaceAll(inputs.password, "[REDACTED]").replaceAll(apiToken, "[REDACTED]");
      const kube = new KubeClient();
      const namespace = config.namespace;
      testInfo.annotations.push(
        { type: "component", description: "data-management" },
        { type: "namespace", description: namespace },
        { type: "database", description: instance.split(":")[2] },
      );
      await deleteOwnedNamespace(kube, namespace, runId);
      await kube.coreV1Api.createNamespace({
        metadata: { name: namespace, labels: { [ownerLabel]: runId } },
      });
      const sql = new CloudSqlDatabaseSession(kube, namespace, inputs.user, inputs.password);
      let sqlReady = false;
      let setupError: unknown;
      try {
        await kube.createOrUpdateSecret(
          {
            metadata: { name: CLOUD_SQL_SA_SECRET },
            data: {
              "service_account.json": base64Encode(inputs.serviceAccountJson),
            },
          },
          namespace,
        );
        await kube.createOrUpdateSecret(
          {
            metadata: { name: CLOUD_SQL_DB_SECRET },
            data: {
              POSTGRES_HOST: base64Encode("127.0.0.1"),
              POSTGRES_PORT: base64Encode("5432"),
              POSTGRES_USER: base64Encode(inputs.user),
              POSTGRES_PASSWORD: base64Encode(inputs.password),
              CLOUDSQL_API_TOKEN: base64Encode(apiToken),
            },
          },
          namespace,
        );
        await kube.createConfigMap(namespace, {
          metadata: { name: "cloud-sql-entity" },
          data: {
            "entity.yaml": yaml.stringify({
              apiVersion: "backstage.io/v1alpha1",
              kind: "Component",
              metadata: { name: entityName },
              spec: { type: "service", lifecycle: "experimental", owner: "guests" },
            }),
          },
        });
        const admin = await sql.start(instance);
        sqlReady = true;
        await clearCloudSqlDatabases(admin, databasePrefix);
        const version = await admin.query<{ version: string; version_number: string }>(
          "SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS version_number",
        );
        await admin.end();
        await testInfo.attach("cloudsql-target", {
          body: JSON.stringify(
            {
              installMethod,
              namespace,
              instance,
              databasePrefix,
              chart: config.helm,
              image: config.image,
              postgres: version.rows[0],
            },
            null,
            2,
          ),
          contentType: "application/json",
        });
        const handle = await deployRuntime(config, installMethod, kube);
        await use({
          ...handle,
          databasePrefix,
          entityName,
          apiToken,
          sql,
          async restart() {
            await stopRuntimeApplication(kube, namespace, config.releaseName, installMethod);
            config.cloudSql!.revision = randomBytes(8).toString("hex");
            await deployRuntime(config, installMethod, kube);
          },
        });
      } catch (error) {
        setupError = error;
      }
      // Capture the application and proxy evidence even on setup failure, before deleting it.
      await collectDiagnostics(kube, namespace, testInfo, redact);
      const cleanupErrors: unknown[] = [];
      try {
        await stopApplication(config, installMethod, kube);
        if (sqlReady) {
          const cleanupClient = await sql.connect();
          try {
            await clearCloudSqlDatabases(cleanupClient, databasePrefix);
          } finally {
            await cleanupClient.end();
          }
        }
        await testInfo.attach("cloudsql-cleanup", {
          body: JSON.stringify({ databasePrefix, completed: sqlReady }),
          contentType: "application/json",
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await sql.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await deleteOwnedNamespace(kube, namespace, runId);
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (cleanupErrors.length > 0) {
        const errors = [...(setupError === undefined ? [] : [setupError]), ...cleanupErrors];
        throw new AggregateError(
          errors,
          `Cloud SQL failed for ${databasePrefix}: ${errors.map((error) => redact(String(error))).join("; ")}`,
        );
      }
      if (setupError !== undefined) {
        throw setupError instanceof Error
          ? setupError
          : new Error("Cloud SQL setup failed", { cause: setupError });
      }
    },
    { timeout: 1_800_000 },
  ],
});

export { expect } from "../coverage/test";
