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

import { base64Encode, getReleaseName, resolveInstallMethod } from "./helper";
import { KubeClient, BACKSTAGE_BACKEND_CONTAINER } from "./kube-client";
import { BACKSTAGE_CR_API_VERSION } from "./runtime-config";
import type { AppConfigYaml } from "./runtime-config";

/**
 * Core POSTGRES_* env var keys used by both schema-mode and external-DB tests
 * to configure the database connection from a Secret.
 */
export const POSTGRES_ENV_KEYS = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
] as const;

/**
 * Env var keys injected into the deployment by external database tests.
 * Does NOT include POSTGRES_DB — external DB tests don't set it in the
 * postgres-cred secret (Backstage auto-creates per-plugin databases).
 * Schema-mode tests manage their own env vars separately via
 * configureSchemaMode() / schema-mode-setup.ts.
 */
const postgresCredEnvKeys = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "PGSSLMODE",
  "NODE_EXTRA_CA_CERTS",
] as const;

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
    POSTGRES_PORT: base64Encode(credentials.port ?? "5432"),
    PGSSLMODE: base64Encode(credentials.sslMode ?? "require"),
    NODE_EXTRA_CA_CERTS: base64Encode("/opt/app-root/src/postgres-crt.pem"),
  };

  if (credentials.user) {
    data.POSTGRES_USER = base64Encode(credentials.user);
  }
  if (credentials.password) {
    data.POSTGRES_PASSWORD = base64Encode(credentials.password);
  }
  if (credentials.database !== undefined && credentials.database !== "") {
    data.POSTGRES_DB = base64Encode(credentials.database);
  }

  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "postgres-cred" },
    data,
  };
  await kubeClient.createOrUpdateSecret(secret, namespace);

  // For operator installs, ensure the Backstage CR includes postgres-cred in
  // extraEnvs.secrets so the operator injects the credentials as env vars.
  // This is done here (not in prepareForExternalDatabase) because the secret
  // must contain real credentials before the operator reconciles — placeholder
  // values would break the DB connection and leave readiness at 503.
  if (resolveInstallMethod() === "operator") {
    await addPostgresCredToBackstageCR(kubeClient, namespace);
  }
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
  // Skip for operator — the operator manages env vars via extraEnvs.secrets
  // in the Backstage CR, so there are no direct deployment patches to remove.
  if (resolveInstallMethod() !== "operator") {
    await removeSchemaModePatchedEnvVars(kubeClient, deploymentName, namespace);
  }

  // --- 2. Patch app-config ConfigMap to use external DB connection ---
  console.log("Patching app-config to use external database connection (env var placeholders)...");
  await kubeClient.patchAppConfig(namespace, (appConfig: AppConfigYaml) => {
    appConfig.backend ??= {};
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

  // --- 3. Add POSTGRES_* env vars to the deployment ---
  // Helm: patch individual env vars pointing to the postgres-cred secret so
  // the app-config ${POSTGRES_HOST} etc. placeholders resolve correctly.
  // Operator: the Backstage CR is patched later by configurePostgresCredentials()
  // after real credentials are written to the postgres-cred secret. Patching the
  // CR here with placeholder values would trigger operator reconciliation and
  // break the DB connection (readiness 503).
  if (resolveInstallMethod() === "operator") {
    console.log(
      "Skipping env var setup (operator CR will be patched by configurePostgresCredentials)",
    );
  } else {
    await ensurePostgresCredEnvVars(kubeClient, deploymentName, namespace);
  }
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
  const removed = await kubeClient.removeContainerEnvVars(
    deploymentName,
    namespace,
    BACKSTAGE_BACKEND_CONTAINER,
    (envVar) =>
      (POSTGRES_ENV_KEYS as readonly string[]).includes(envVar.name) &&
      (envVar.valueFrom?.secretKeyRef?.name?.endsWith("-postgresql") ?? false),
  );

  if (removed > 0) {
    console.log(`Removed ${removed} schema-mode env var patches from deployment`);
  } else {
    console.log("No schema-mode env var patches found on deployment");
  }
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
  console.log(
    `Adding ${postgresCredEnvKeys.length} POSTGRES_* env vars from postgres-cred to deployment`,
  );
  await kubeClient.addContainerEnvVarsFromSecret(
    deploymentName,
    namespace,
    BACKSTAGE_BACKEND_CONTAINER,
    "postgres-cred",
    [...postgresCredEnvKeys],
  );
  console.log("POSTGRES_* env vars added to deployment from postgres-cred");
}

/**
 * Patch the operator Backstage CR to add postgres-cred to extraEnvs.secrets.
 * This causes the operator to inject all keys from the postgres-cred secret
 * as env vars into the RHDH container.
 *
 * The postgres-cred secret is NOT included in the CR at deployment time —
 * it contains placeholder values that would override the operator-managed
 * internal PostgreSQL credentials. It is only added here, when external DB
 * tests need the real credentials injected.
 *
 * Uses JSON merge-patch so the secrets array is replaced wholesale.
 * The CR is created by generateBackstageCR() with only rhdh-runtime-config
 * in extraEnvs.secrets, so we set both here explicitly.
 */
async function addPostgresCredToBackstageCR(
  kubeClient: KubeClient,
  namespace: string,
): Promise<void> {
  const releaseName = getReleaseName();
  const [group, version] = BACKSTAGE_CR_API_VERSION.split("/");

  const patch = {
    spec: {
      application: {
        extraEnvs: {
          secrets: [{ name: "rhdh-runtime-config" }, { name: "postgres-cred" }],
        },
      },
    },
  };

  await kubeClient.customObjectsApi.patchNamespacedCustomObject(
    group,
    version,
    namespace,
    "backstages",
    releaseName,
    patch,
    undefined,
    undefined,
    undefined,
    { headers: { "Content-Type": "application/merge-patch+json" } },
  );
  console.log("Patched Backstage CR: added postgres-cred to extraEnvs.secrets");
}
