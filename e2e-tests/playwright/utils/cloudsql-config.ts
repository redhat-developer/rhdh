import { readFileSync } from "node:fs";

import type { V1Container, V1Deployment, V1Volume } from "@kubernetes/client-node";

import { RUNTIME_DATABASE_KNEX_CONFIG } from "./postgres-config";

/** Explicit version shared by the application sidecar and independent SQL proxy. */
export const CLOUD_SQL_PROXY_IMAGE = "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.26.0";
export const CLOUD_SQL_SA_SECRET = "cloud-sql-service-account";
export const CLOUD_SQL_DB_SECRET = "cloud-sql-database";
export const CLOUD_SQL_PROXY_CONTAINER = "cloud-sql-proxy";

export interface CloudSqlDeploymentConfig {
  instanceConnectionName: string;
  user: string;
  databasePrefix: string;
  revision: string;
}

export interface CloudSqlInputs {
  instances: Array<string | undefined>;
  user: string;
  password: string;
  serviceAccountJson: string;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Unconfigured instances are skipped; configured instances require valid credentials. */
export function readCloudSqlInputs(env: NodeJS.ProcessEnv = process.env): CloudSqlInputs | null {
  const instances = [1, 2, 3, 4].map((slot) => {
    const value = env[`CLOUDSQL_INSTANCE_${slot}`]?.trim();
    return isNonEmptyString(value) ? value : undefined;
  });
  if (instances.every((instance) => instance === undefined)) return null;
  for (const instance of instances) {
    if (instance !== undefined && !/^[^\s:]+:[^\s:]+:[^\s:]+$/u.test(instance)) {
      throw new Error(
        "Cloud SQL instance connection names must have project:region:instance format",
      );
    }
  }
  const user = env.CLOUDSQL_USER;
  const password = env.CLOUDSQL_PASSWORD;
  const jsonPath = env.CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH;
  if (!isNonEmptyString(user) || !isNonEmptyString(password) || !isNonEmptyString(jsonPath)) {
    throw new Error(
      "Configured Cloud SQL tests require CLOUDSQL_USER, CLOUDSQL_PASSWORD and CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH",
    );
  }
  let serviceAccountJson: string;
  try {
    serviceAccountJson = readFileSync(jsonPath, "utf8");
    const key: unknown = JSON.parse(serviceAccountJson);
    if (
      typeof key !== "object" ||
      key === null ||
      Reflect.get(key, "type") !== "service_account" ||
      !isNonEmptyString(Reflect.get(key, "client_email")) ||
      !isNonEmptyString(Reflect.get(key, "private_key"))
    )
      throw new Error("Invalid service account");
  } catch {
    // JSON.parse errors can include fragments of the private key. Do not forward them.
    throw new Error(
      "CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH must contain a readable service-account JSON key",
    );
  }
  return { instances, user, password, serviceAccountJson };
}

/** Short enough to leave room for plugin IDs in PostgreSQL's 63-byte identifiers. */
export function cloudSqlDatabasePrefix(runId: string, slot: number): string {
  if (!/^[a-f0-9]{12}$/u.test(runId) || ![1, 2, 3, 4].includes(slot)) {
    throw new Error("Cloud SQL ownership requires a 12-hex run ID and instance slot 1..4");
  }
  return `csql_${runId}_${slot}_`;
}

export function buildCloudSqlProxyVolume(): V1Volume {
  return { name: "cloud-sql-key", secret: { secretName: CLOUD_SQL_SA_SECRET } };
}

/** Additive allowance: Operator's default DB policy permits 5432, whereas Auth Proxy uses 3307. */
export function buildCloudSqlEgressPolicy(deploymentName: string) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "cloud-sql-proxy-egress" },
    spec: {
      podSelector: { matchLabels: { "rhdh.redhat.com/app": deploymentName } },
      policyTypes: ["Egress"],
      egress: [{ ports: [{ port: 3307, protocol: "TCP" }] }],
    },
  };
}

/** Native sidecar starts before the DB wait and stays up for the application lifetime. */
export function buildCloudSqlProxy(instanceConnectionName: string, sidecar = true): V1Container {
  return {
    name: CLOUD_SQL_PROXY_CONTAINER,
    image: CLOUD_SQL_PROXY_IMAGE,
    ...(sidecar ? { restartPolicy: "Always" } : {}),
    args: [
      "--structured-logs",
      "--credentials-file=/secrets/service_account.json",
      "--port=5432",
      "--health-check",
      "--http-address=0.0.0.0",
      "--http-port=9801",
      "--run-connection-test",
      instanceConnectionName,
    ],
    startupProbe: {
      httpGet: { path: "/startup", port: 9801 },
      periodSeconds: 2,
      timeoutSeconds: 5,
      failureThreshold: 60,
    },
    livenessProbe: {
      httpGet: { path: "/liveness", port: 9801 },
      periodSeconds: 30,
      timeoutSeconds: 5,
    },
    securityContext: {
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
    resources: { requests: { cpu: "100m", memory: "128Mi" } },
    volumeMounts: [{ name: "cloud-sql-key", mountPath: "/secrets", readOnly: true }],
  };
}

/** Require all replicas to belong to the intended revision before accepting readiness. */
export function isCloudSqlRevisionReady(
  deployment: V1Deployment,
  config: CloudSqlDeploymentConfig,
): boolean {
  const proxy = deployment.spec?.template.spec?.initContainers?.find(
    (container) => container.name === CLOUD_SQL_PROXY_CONTAINER,
  );
  const desired = deployment.spec?.replicas ?? 1;
  const status = deployment.status;
  return (
    deployment.spec?.template.spec?.initContainers?.[0]?.name === CLOUD_SQL_PROXY_CONTAINER &&
    deployment.spec?.template.metadata?.annotations?.["rhdh.redhat.com/cloudsql-revision"] ===
      config.revision &&
    proxy?.args?.includes(config.instanceConnectionName) === true &&
    proxy.restartPolicy === "Always" &&
    desired > 0 &&
    (status?.observedGeneration ?? 0) >= (deployment.metadata?.generation ?? 1) &&
    status?.updatedReplicas === desired &&
    status.readyReplicas === desired &&
    status.availableReplicas === desired &&
    status.replicas === desired
  );
}

export function cloudSqlAppConfig(config: CloudSqlDeploymentConfig) {
  return {
    database: {
      client: "pg",
      pluginDivisionMode: "database",
      prefix: config.databasePrefix,
      knexConfig: RUNTIME_DATABASE_KNEX_CONFIG,
      connection: {
        host: "${POSTGRES_HOST}",
        port: "${POSTGRES_PORT}",
        user: "${POSTGRES_USER}",
        password: "${POSTGRES_PASSWORD}",
        ssl: false,
      },
    },
  };
}
