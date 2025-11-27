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

/**
 * Convert escaped newlines (\n) to actual newline characters.
 * Environment variables from Vault often have literal \n instead of newlines.
 */
function unescapeNewlines(value: string): string {
  return value.replace(/\\n/g, "\n");
}

/**
 * Read certificate content from a file path.
 * @param filePath - Path to the certificate file
 * @returns Certificate content with escaped newlines converted, or null if file doesn't exist
 */
export function readCertificateFile(
  filePath: string | undefined,
): string | null {
  if (!filePath) {
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
    sslMode?: string;
  },
): Promise<void> {
  const data: Record<string, string> = {
    POSTGRES_HOST: Buffer.from(credentials.host).toString("base64"),
    POSTGRES_PORT: Buffer.from(credentials.port || "5432").toString("base64"),
    PGSSLMODE: Buffer.from(credentials.sslMode || "require").toString("base64"),
    NODE_EXTRA_CA_CERTS: Buffer.from(
      "/opt/app-root/src/postgres-crt.pem",
    ).toString("base64"),
  };

  if (credentials.user) {
    data.POSTGRES_USER = Buffer.from(credentials.user).toString("base64");
  }
  if (credentials.password) {
    data.POSTGRES_PASSWORD = Buffer.from(credentials.password).toString(
      "base64",
    );
  }

  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "postgres-cred" },
    data,
  };
  await kubeClient.createOrUpdateSecret(secret, namespace);
}

/**
 * Clear all non-system databases from a PostgreSQL instance.
 * Used to clean up after external database tests.
 *
 * @param credentials - Database connection credentials
 * @param credentials.host - PostgreSQL host
 * @param credentials.port - PostgreSQL port (default: "5432")
 * @param credentials.user - PostgreSQL user
 * @param credentials.password - PostgreSQL password
 * @param certificatePath - Optional path to TLS certificate file
 */
export async function clearDatabase(credentials: {
  host: string;
  port?: string;
  user: string;
  password: string;
  certificatePath?: string;
}): Promise<void> {
  console.log("Starting database cleanup process...");

  // System databases that should never be dropped (includes cloud provider managed databases)
  const systemDatabases = [
    "postgres",
    "template0",
    "template1",
    // AWS RDS system databases
    "rdsadmin",
    // Azure Database for PostgreSQL system databases
    "azure_maintenance",
    "azure_sys",
  ];

  // Read certificate if path is provided
  let ssl: { ca: string } | boolean = true;
  if (credentials.certificatePath) {
    const certContent = readCertificateFile(credentials.certificatePath);
    if (certContent) {
      ssl = { ca: certContent };
    }
  }

  const client = new Client({
    host: credentials.host,
    port: parseInt(credentials.port || "5432"),
    user: credentials.user,
    password: credentials.password,
    database: "postgres",
    ssl,
    connectionTimeoutMillis: 30 * 1000,
    query_timeout: 120 * 1000,
  });

  try {
    await client.connect();

    // Get list of databases
    const result = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datistemplate = false",
    );

    const databases = result.rows
      .map((row) => row.datname)
      .filter((db) => !systemDatabases.includes(db));

    if (databases.length === 0) {
      console.log("No databases found to drop");
      return;
    }

    console.log(`Found databases to drop: ${databases.join(", ")}`);

    const succeeded: string[] = [];
    const failed: string[] = [];

    // Execute drops sequentially
    for (const db of databases) {
      let success = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // WITH (FORCE) atomically terminates connections and drops the database
          await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
          success = true;
          break;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const isRetryable =
            errorMsg.includes("being accessed by other users") ||
            errorMsg.includes("in use") ||
            errorMsg.includes("timeout");

          if (isRetryable && attempt < maxRetries) {
            const delay = attempt * 1000; // 1s, 2s, 3s
            console.log(
              `Retry ${attempt}/${maxRetries} for database ${db} after ${delay}ms (${errorMsg})`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            console.warn(`Warning: Failed to drop database ${db}:`, errorMsg);
            break;
          }
        }
      }

      if (success) {
        succeeded.push(db);
      } else {
        failed.push(db);
      }
    }

    console.log(
      `Database cleanup completed: ${succeeded.length} dropped, ${failed.length} failed`,
    );
    if (succeeded.length > 0) {
      console.log(`Successfully dropped: ${succeeded.join(", ")}`);
    }
    if (failed.length > 0) {
      console.log(`Failed to drop: ${failed.join(", ")}`);
    }
  } catch (error) {
    console.error(
      "Failed to connect to database or retrieve database list:",
      error,
    );
    throw error;
  } finally {
    await client.end();
  }
}
