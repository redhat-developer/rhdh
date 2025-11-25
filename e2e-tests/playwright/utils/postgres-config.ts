/**
 * PostgreSQL configuration utilities for external database tests.
 * Provides functions to configure TLS certificates and database credentials
 * via Kubernetes secrets for testing with external PostgreSQL instances
 * (Azure Database for PostgreSQL, Amazon RDS, etc.).
 *
 * Certificates are loaded from environment variables set by CI pipeline (from Vault).
 * Each test file can import and apply its required configuration.
 */

import { KubeClient } from "./kube-client";

/**
 * Convert escaped newlines (\n) to actual newline characters.
 * Environment variables from Vault often have literal \n instead of newlines.
 */
function unescapeNewlines(value: string): string {
  return value.replace(/\\n/g, "\n");
}

/**
 * Get Azure Database for PostgreSQL certificates from environment variable.
 */
export function getAzureDbCertificates(): string | null {
  const cert = process.env.AZURE_DB_CERTIFICATES;
  return cert ? unescapeNewlines(cert) : null;
}

/**
 * Get Amazon RDS certificates from environment variable.
 */
export function getRdsDbCertificates(): string | null {
  const cert = process.env.RDS_DB_CERTIFICATES;
  return cert ? unescapeNewlines(cert) : null;
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
