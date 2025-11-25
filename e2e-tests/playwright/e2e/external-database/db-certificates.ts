/**
 * Database TLS certificates for external database tests.
 * Certificates are loaded from environment variables set by CI pipeline (from Vault).
 * Each test file can import and apply its required certificates.
 */

import { KubeClient } from "../../utils/kube-client";

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
 * Create or update a Kubernetes secret
 */
async function createOrUpdateSecret(
  kubeClient: KubeClient,
  secretName: string,
  namespace: string,
  data: Record<string, string>,
): Promise<void> {
  const patch = { data };

  try {
    // Try to update existing secret
    await kubeClient.updateSecret(secretName, namespace, patch);
    console.log(`Secret ${secretName} updated in namespace ${namespace}`);
  } catch {
    // Secret doesn't exist, create it
    console.log(
      `Secret ${secretName} not found, creating in namespace ${namespace}`,
    );
    const secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName },
      data,
    };
    await kubeClient.createSecret(secret, namespace);
    console.log(`Secret ${secretName} created in namespace ${namespace}`);
  }
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
  await createOrUpdateSecret(kubeClient, "postgres-crt", namespace, {
    "postgres-crt.pem": certBase64,
  });
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

  await createOrUpdateSecret(kubeClient, "postgres-cred", namespace, data);
}
