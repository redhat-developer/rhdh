/**
 * PostgreSQL configuration utilities for external database tests.
 * Provides functions to configure TLS certificates and database credentials
 * via Kubernetes secrets for testing with external PostgreSQL instances
 * (Azure Database for PostgreSQL, Amazon RDS, etc.).
 *
 * Certificates are loaded from file paths set by CI pipeline (from Vault).
 * File paths are used instead of loading content into env vars to avoid
 * "Argument list too long" shell errors with large certificate bundles.
 * Each test file can import and apply its required configuration.
 */

import { readFileSync, existsSync } from "fs";

import { Client } from "pg";
import * as k8s from "@kubernetes/client-node";
import { KubeClient } from "./kube-client";
import { base64Encode } from "./helper";
import type { AppConfigYaml } from "./runtime-config";

/**
 * Convert escaped newlines (\n) to actual newline characters.
 * Environment variables from Vault often have literal \n instead of newlines.
 */
function unescapeNewlines(value: string): string {
  return value.replaceAll("\\n", "\n");
}

/**
 * Read certificate content from a file path.
 * @param filePath - Path to the certificate file
 * @returns Certificate content with escaped newlines converted, or null if file doesn't exist
 */
export function readCertificateFile(filePath: string | undefined): string | null {
  if (filePath === undefined || filePath === "") {
    return null;
  }
  if (!existsSync(filePath)) {
    console.warn(`Certificate file not found: ${filePath}`);
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  return unescapeNewlines(content);
}

/**
 * Configure the postgres-crt secret with certificate content
 */
export async function configurePostgresCertificate(
  kubeClient: KubeClient,
  namespace: string,
  pemContent: string,
): Promise<void> {
  const certBase64 = base64Encode(pemContent);
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "postgres-crt" },
    data: { "postgres-crt.pem": certBase64 },
  };
  await kubeClient.createOrUpdateSecret(secret, namespace);
}

/**
 * Configure the postgres-cred secret with database credentials
 */
export async function configurePostgresCredentials(
  kubeClient: KubeClient,
  namespace: string,
  credentials: {
    host: string;
    port?: string;
    user: string;
    password: string;
    database?: string;
    sslMode?: string;
  },
): Promise<void> {
  const data: Record<string, string> = {
    POSTGRES_HOST: base64Encode(credentials.host),
    POSTGRES_PORT: base64Encode(credentials.port || "5432"),
    PGSSLMODE: base64Encode(credentials.sslMode || "require"),
    NODE_EXTRA_CA_CERTS: base64Encode("/opt/app-root/src/postgres-crt.pem"),
  };

  if (credentials.user) {
    data.POSTGRES_USER = base64Encode(credentials.user);
  }
  if (credentials.password) {
    data.POSTGRES_PASSWORD = base64Encode(credentials.password);
  }
  if (credentials.database) {
    data.POSTGRES_DB = base64Encode(credentials.database);
  }

  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "postgres-cred" },
    data,
  };
  await kubeClient.createOrUpdateSecret(secret, namespace);
}

const SYSTEM_DATABASES = [
  "postgres",
  "template0",
  "template1",
  "rdsadmin",
  "azure_maintenance",
  "azure_sys",
];

function buildSslConfig(certificatePath: string | undefined): { ca: string } | boolean {
  if (certificatePath === undefined || certificatePath === "") {
    return true;
  }
  const certContent = readCertificateFile(certificatePath);
  if (certContent === null) {
    return true;
  }
  return { ca: certContent };
}

function isRetryableDropError(errorMsg: string): boolean {
  return (
    errorMsg.includes("being accessed by other users") ||
    errorMsg.includes("in use") ||
    errorMsg.includes("timeout")
  );
}

async function dropDatabaseWithRetry(
  client: Client,
  db: string,
  maxRetries: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const canRetry = isRetryableDropError(errorMsg) && attempt < maxRetries;
      if (!canRetry) {
        console.warn(`Warning: Failed to drop database ${db}:`, errorMsg);
        return false;
      }
      const delay = attempt * 1000;
      console.log(
        `Retry ${attempt}/${maxRetries} for database ${db} after ${delay}ms (${errorMsg})`,
      );
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, delay);
      });
    }
  }
  return false;
}

async function dropUserDatabases(
  client: Client,
  databases: string[],
): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const maxRetries = 3;

  for (const db of databases) {
    const success = await dropDatabaseWithRetry(client, db, maxRetries);
    if (success) {
      succeeded.push(db);
    } else {
      failed.push(db);
    }
  }

  return { succeeded, failed };
}

/**
 * Clear all non-system databases from a PostgreSQL instance.
 * Used to clean up after external database tests.
 */
export async function clearDatabase(credentials: {
  host: string;
  port?: string;
  user: string;
  password: string;
  certificatePath?: string;
}): Promise<void> {
  console.log("Starting database cleanup process...");

  const client = new Client({
    host: credentials.host,
    port: Math.trunc(Number(credentials.port ?? "5432")),
    user: credentials.user,
    password: credentials.password,
    database: "postgres",
    ssl: buildSslConfig(credentials.certificatePath),
    connectionTimeoutMillis: 30 * 1000,
    query_timeout: 120 * 1000,
  });

  try {
    await client.connect();

    const result = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datistemplate = false",
    );

    const databases = result.rows
      .map((row) => row.datname)
      .filter((db) => !SYSTEM_DATABASES.includes(db));

    if (databases.length === 0) {
      console.log("No databases found to drop");
      return;
    }

    console.log(`Found databases to drop: ${databases.join(", ")}`);

    const { succeeded, failed } = await dropUserDatabases(client, databases);

    console.log(`Database cleanup completed: ${succeeded.length} dropped, ${failed.length} failed`);
    if (succeeded.length > 0) {
      console.log(`Successfully dropped: ${succeeded.join(", ")}`);
    }
    if (failed.length > 0) {
      console.log(`Failed to drop: ${failed.join(", ")}`);
    }
  } catch (error) {
    console.error("Failed to connect to database or retrieve database list:", error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Prepare the RHDH deployment for external database tests.
 *
 * The runtime deployment starts with an internal (operator-managed or Helm sub-chart)
 * PostgreSQL. This function switches the configuration to use an external database by:
 *
 * 1. Removing any stale POSTGRES_* env var patches left by schema-mode tests
 * 2. Patching the app-config ConfigMap to add backend.database.connection with
 *    env var placeholders (${POSTGRES_HOST}, etc.) so that the postgres-cred
 *    secret values are used for the DB connection
 * 3. Adding POSTGRES_* env vars to the deployment via secretKeyRef from postgres-cred
 *
 * After calling this function, the test should:
 * - Call configurePostgresCertificate() to set the TLS cert
 * - Call configurePostgresCredentials() with real external DB credentials
 * - Call kubeClient.restartDeployment() to apply the changes
 *
 * @param kubeClient - KubeClient instance
 * @param namespace - Kubernetes namespace
 * @param deploymentName - Name of the RHDH deployment
 */
export async function prepareForExternalDatabase(
  kubeClient: KubeClient,
  namespace: string,
  deploymentName: string,
): Promise<void> {
  // --- 1. Remove stale POSTGRES_* env vars patched onto the deployment ---
  // Schema-mode tests may have added individual secretKeyRef env vars pointing
  // to a *-postgresql secret. These override the bulk envFrom injection from
  // postgres-cred and must be removed before external DB tests.
  await removeSchemaModePatchedEnvVars(kubeClient, deploymentName, namespace);

  // --- 2. Patch app-config ConfigMap to use external DB connection ---
  console.log(
    "Patching app-config to use external database connection (env var placeholders)...",
  );
  await kubeClient.patchAppConfig(namespace, (appConfig: AppConfigYaml) => {
    appConfig.backend = appConfig.backend || {};
    appConfig.backend.database = {
      connection: {
        host: "${POSTGRES_HOST}",
        port: "${POSTGRES_PORT}",
        user: "${POSTGRES_USER}",
        password: "${POSTGRES_PASSWORD}",
      },
    };
  });
  console.log("App-config patched for external database connection");

  // --- 3. Add POSTGRES_* env vars to the deployment via secretKeyRef ---
  // The deployment starts with internal DB (no postgres-cred env vars).
  // Add individual env vars pointing to the postgres-cred secret so the
  // app-config ${POSTGRES_HOST} etc. placeholders resolve correctly.
  await ensurePostgresCredEnvVars(kubeClient, deploymentName, namespace);
}

/**
 * Remove POSTGRES_* env vars from the deployment that were injected via secretKeyRef
 * by schema-mode tests (pointing to the *-postgresql secret). These override the
 * env vars injected by the operator/helm via extraEnvs/extraEnvVarsSecrets from postgres-cred.
 */
async function removeSchemaModePatchedEnvVars(
  kubeClient: KubeClient,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  const response = await kubeClient.appsApi.readNamespacedDeployment(
    deploymentName,
    namespace,
  );
  const containers = response.body.spec?.template?.spec?.containers || [];
  const backstageIdx = containers.findIndex(
    (c) => c.name === "backstage-backend",
  );
  const backstageContainer = containers[backstageIdx];

  if (!backstageContainer?.env) {
    return;
  }

  // Find env vars that reference a *-postgresql secret (added by schema-mode)
  const schemaModeVars = [
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
  ];
  const indicesToRemove: number[] = [];

  backstageContainer.env.forEach((envVar: k8s.V1EnvVar, idx: number) => {
    if (
      schemaModeVars.includes(envVar.name) &&
      envVar.valueFrom?.secretKeyRef?.name?.endsWith("-postgresql")
    ) {
      indicesToRemove.push(idx);
    }
  });

  if (indicesToRemove.length === 0) {
    console.log("No schema-mode env var patches found on deployment");
    return;
  }

  console.log(
    `Removing ${indicesToRemove.length} schema-mode env var patches from deployment...`,
  );

  // Build JSON patch to remove indices in reverse order (so indices stay valid)
  const patch = indicesToRemove
    .sort((a, b) => b - a)
    .map((idx) => ({
      op: "remove" as const,
      path: `/spec/template/spec/containers/${backstageIdx}/env/${idx}`,
    }));

  await kubeClient.jsonPatchDeployment(deploymentName, namespace, patch);
  console.log("Schema-mode env var patches removed from deployment");
}

/**
 * Set POSTGRES_* env vars on the deployment via secretKeyRef from the postgres-cred secret.
 * Removes any existing env vars with the same names first (regardless of their source —
 * they may come from Helm chart templates, schema-mode patches, or other sources),
 * then adds fresh secretKeyRef entries pointing to the postgres-cred secret.
 * This ensures the app-config ${POSTGRES_HOST} etc. placeholders resolve from postgres-cred.
 */
async function ensurePostgresCredEnvVars(
  kubeClient: KubeClient,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  const response = await kubeClient.appsApi.readNamespacedDeployment(
    deploymentName,
    namespace,
  );
  const containers = response.body.spec?.template?.spec?.containers || [];
  const backstageIdx = containers.findIndex(
    (c) => c.name === "backstage-backend",
  );

  if (backstageIdx === -1) {
    console.warn(
      "backstage-backend container not found, skipping env var injection",
    );
    return;
  }

  const backstageContainer = containers[backstageIdx];
  const existingEnv = backstageContainer.env || [];

  const requiredVars = [
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "PGSSLMODE",
    "NODE_EXTRA_CA_CERTS",
  ];

  // Remove existing env vars that we need to replace (in reverse index order)
  const indicesToRemove = existingEnv
    .map((e: k8s.V1EnvVar, idx: number) => ({ name: e.name, idx }))
    .filter((e: { name: string; idx: number }) => requiredVars.includes(e.name))
    .map((e: { name: string; idx: number }) => e.idx);

  const patch: Array<{ op: string; path: string; value?: unknown }> = [];

  if (indicesToRemove.length > 0) {
    console.log(
      `Removing ${indicesToRemove.length} existing POSTGRES_* env vars from deployment`,
    );
    // Remove in reverse order so indices stay valid
    for (const idx of indicesToRemove.sort((a: number, b: number) => b - a)) {
      patch.push({
        op: "remove",
        path: `/spec/template/spec/containers/${backstageIdx}/env/${idx}`,
      });
    }
  }

  // Add env vars from postgres-cred secret
  const envVarsToAdd = [
    { name: "POSTGRES_HOST", key: "POSTGRES_HOST" },
    { name: "POSTGRES_PORT", key: "POSTGRES_PORT" },
    { name: "POSTGRES_USER", key: "POSTGRES_USER" },
    { name: "POSTGRES_PASSWORD", key: "POSTGRES_PASSWORD" },
    { name: "PGSSLMODE", key: "PGSSLMODE" },
    {
      name: "NODE_EXTRA_CA_CERTS",
      key: "NODE_EXTRA_CA_CERTS",
    },
  ];

  for (const envVar of envVarsToAdd) {
    patch.push({
      op: "add",
      path: `/spec/template/spec/containers/${backstageIdx}/env/-`,
      value: {
        name: envVar.name,
        valueFrom: {
          secretKeyRef: {
            name: "postgres-cred",
            key: envVar.key,
          },
        },
      },
    });
  }

  console.log(
    `Adding ${envVarsToAdd.length} POSTGRES_* env vars from postgres-cred to deployment`,
  );
  await kubeClient.jsonPatchDeployment(deploymentName, namespace, patch);
  console.log("POSTGRES_* env vars added to deployment from postgres-cred");
}
