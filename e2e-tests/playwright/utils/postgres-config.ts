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

import { KubeClient } from "./kube-client";
import { sleep } from "./poll-until";

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
  const certBase64 = Buffer.from(pemContent).toString("base64");
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
    POSTGRES_HOST: Buffer.from(credentials.host).toString("base64"),
    POSTGRES_PORT: Buffer.from(credentials.port ?? "5432").toString("base64"),
    PGSSLMODE: Buffer.from(credentials.sslMode ?? "require").toString("base64"),
    NODE_EXTRA_CA_CERTS: Buffer.from("/opt/app-root/src/postgres-crt.pem").toString("base64"),
  };

  if (credentials.user !== "") {
    data.POSTGRES_USER = Buffer.from(credentials.user).toString("base64");
  }
  if (credentials.password !== "") {
    data.POSTGRES_PASSWORD = Buffer.from(credentials.password).toString("base64");
  }
  if (credentials.database !== undefined && credentials.database !== "") {
    data.POSTGRES_DB = Buffer.from(credentials.database).toString("base64");
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
      await sleep(delay);
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
