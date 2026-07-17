/**
 * Database setup and connection utilities for schema mode E2E tests.
 */

import { expect } from "@playwright/test";
import { Client } from "pg";
import type { ClientConfig } from "pg";

import { base64Decode } from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";
import { getPortForwardRestarter } from "../../utils/port-forward";

/** Default schema-mode test database user (overridable via SCHEMA_MODE_DB_USER). */
const SCHEMA_MODE_DEFAULT_DB_USER = "bn_backstage";
/** Default schema-mode test database password (overridable via env). */
function getSchemaModeDefaultDbPassword(): string {
  return (
    process.env.SCHEMA_MODE_DEFAULT_DB_PASSWORD ??
    process.env.POSTGRES_PASSWORD ??
    "test_password_123"
  );
}

export interface SchemaModeEnv {
  dbHost: string;
  dbAdminUser: string;
  dbAdminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

function quoteIdent(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}

function escapePasswordLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeDbHost(host: string): string {
  return host === "localhost" ? "127.0.0.1" : host;
}

function connectionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConnectionDeadError(errorMsg: string): boolean {
  return (
    errorMsg.includes("ECONNREFUSED") ||
    errorMsg.includes("connection reset") ||
    errorMsg.includes("ECONNRESET") ||
    errorMsg.includes("EPIPE")
  );
}

async function tryRestartPortForward(
  attempt: number,
  maxRetries: number,
  errorMsg: string,
): Promise<void> {
  if (!isConnectionDeadError(errorMsg) || !getPortForwardRestarter()) {
    console.warn(`Connection attempt ${attempt}/${maxRetries} failed, retrying...`);
    return;
  }

  console.warn(
    `Connection attempt ${attempt}/${maxRetries} failed (${errorMsg}), restarting port-forward...`,
  );
  try {
    await getPortForwardRestarter()!();
  } catch (pfErr) {
    console.error(
      `Port-forward restart failed: ${pfErr instanceof Error ? pfErr.message : String(pfErr)}`,
    );
  }
}

async function waitBeforeConnectRetry(attempt: number): Promise<void> {
  const delay = Math.min(2000 * attempt, 10000);
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, delay);
  });
}

async function connectWithRetry(config: ClientConfig): Promise<Client> {
  const maxRetries = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = new Client(config);
    try {
      await client.connect();
      if (attempt > 1) {
        console.log(`Connected after ${attempt} attempts`);
      }
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});

      if (attempt < maxRetries) {
        const errorMsg = connectionErrorMessage(error);
        await tryRestartPortForward(attempt, maxRetries, errorMsg);
        await waitBeforeConnectRetry(attempt);
      }
    }
  }

  const errorMsg = connectionErrorMessage(lastError);
  throw new Error(`Failed to connect after ${maxRetries} attempts: ${errorMsg}`);
}

const defaultConnectionOptions: Partial<ClientConfig> = {
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

async function connectWithSslFallback(config: ClientConfig): Promise<Client> {
  // Try SSL first (single attempt), fall back to non-SSL if the server doesn't support it.
  const sslConfig = { ...defaultConnectionOptions, ...config };
  const sslClient = new Client(sslConfig);
  try {
    await sslClient.connect();
    return sslClient;
  } catch (sslError) {
    await sslClient.end().catch(() => {});
    const sslMsg = sslError instanceof Error ? sslError.message : String(sslError);
    // Bitnami PostgreSQL sub-chart doesn't enable SSL by default
    if (sslMsg.includes("SSL") || sslMsg.includes("ssl") || sslMsg.includes("does not support")) {
      console.log(`SSL connection failed (${sslMsg}), falling back to non-SSL...`);
      return connectWithRetry({ ...config, ssl: false });
    }
    // For non-SSL errors (e.g. ECONNREFUSED), retry with SSL (port-forward may not be ready)
    return connectWithRetry(sslConfig);
  }
}

export function getSchemaModeEnv(): SchemaModeEnv {
  const dbHost = process.env.SCHEMA_MODE_DB_HOST;
  const dbAdminPassword = process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD;
  const dbPassword = process.env.SCHEMA_MODE_DB_PASSWORD;

  expect(dbHost, "SCHEMA_MODE_DB_HOST must be set for schema-mode tests").toBeTruthy();
  expect(
    dbAdminPassword,
    "SCHEMA_MODE_DB_ADMIN_PASSWORD must be set for schema-mode tests",
  ).toBeTruthy();
  expect(dbPassword, "SCHEMA_MODE_DB_PASSWORD must be set for schema-mode tests").toBeTruthy();

  return {
    dbHost: dbHost!,
    dbAdminUser: process.env.SCHEMA_MODE_DB_ADMIN_USER ?? "postgres",
    dbAdminPassword: dbAdminPassword!,
    dbName: process.env.SCHEMA_MODE_DB_NAME ?? "postgres",
    dbUser: process.env.SCHEMA_MODE_DB_USER ?? "backstage_schema_user",
    dbPassword: dbPassword!,
  };
}

export function connectAdminClient(
  config: Pick<SchemaModeEnv, "dbHost" | "dbAdminUser" | "dbAdminPassword">,
): Promise<Client> {
  return connectWithSslFallback({
    host: normalizeDbHost(config.dbHost),
    port: 5432,
    user: config.dbAdminUser,
    password: config.dbAdminPassword,
    database: "postgres",
    connectionTimeoutMillis: 30000,
  });
}

export async function cleanupOldPluginDatabases(adminClient: Client): Promise<void> {
  const oldDbsResult = await adminClient.query<{ datname: string }>(`
    SELECT datname FROM pg_database
    WHERE datistemplate = false
      AND datname LIKE 'backstage_plugin_%'
  `);

  if (oldDbsResult.rows.length === 0) {
    console.log("✓ No old plugin databases to clean up");
    return;
  }

  console.log(`Found ${oldDbsResult.rows.length} old plugin databases, cleaning up...`);

  for (const db of oldDbsResult.rows) {
    try {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [db.datname],
      );

      await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(db.datname)}`);
      console.log(`  Dropped: ${db.datname}`);
    } catch (err) {
      console.warn(
        `  Could not drop ${db.datname}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export async function setupSchemaModeDatabase(
  adminClient: Client,
  config: SchemaModeEnv,
): Promise<void> {
  const { dbHost, dbAdminUser, dbAdminPassword, dbName, dbUser, dbPassword } = config;

  if (dbName === "postgres") {
    console.log(`✓ Using default postgres database`);
  } else {
    await adminClient.query(`CREATE DATABASE ${quoteIdent(dbName)}`).catch(() => {});
    console.log(`✓ Created/verified test database: ${dbName}`);
  }

  await adminClient
    .query(
      `CREATE USER ${quoteIdent(dbUser)}
       WITH PASSWORD '${escapePasswordLiteral(dbPassword)}'
       NOSUPERUSER NOCREATEDB`,
    )
    .catch(async (err: Error) => {
      if (err.message.includes("already exists")) {
        await adminClient.query(
          `ALTER USER ${quoteIdent(dbUser)}
           WITH PASSWORD '${escapePasswordLiteral(dbPassword)}'
           NOSUPERUSER NOCREATEDB`,
        );
      } else {
        throw err;
      }
    });

  const otherDbs = await adminClient.query<{ datname: string }>(
    `SELECT datname FROM pg_database
     WHERE datistemplate = false AND datname <> $1`,
    [dbName],
  );

  for (const row of otherDbs.rows) {
    try {
      await adminClient.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdent(row.datname)}
         FROM ${quoteIdent(dbUser)}`,
      );
    } catch {
      // Ignore
    }
  }

  await adminClient.query(
    `GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
  );

  await adminClient.end();

  const dbClient = await connectWithSslFallback({
    host: normalizeDbHost(dbHost),
    port: 5432,
    user: dbAdminUser,
    password: dbAdminPassword,
    database: dbName,
    connectionTimeoutMillis: 30000,
  });

  try {
    await dbClient.query(`GRANT CREATE ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`);
    await dbClient.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(dbUser)}`);
    await dbClient.query(`GRANT CREATE ON SCHEMA public TO ${quoteIdent(dbUser)}`);
    await dbClient.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
    );
    await dbClient.query(`ALTER SCHEMA public OWNER TO ${quoteIdent(dbUser)}`);
    console.log("✓ Database permissions configured");
  } finally {
    await dbClient.end();
  }

  console.log("Verifying test database connection...");
  const testClient = await connectWithSslFallback({
    host: normalizeDbHost(dbHost),
    port: 5432,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    connectionTimeoutMillis: 10000,
  });

  try {
    await testClient.query("SELECT 1");
    console.log("✓ Test database connection verified");
  } finally {
    await testClient.end();
  }
}

/**
 * Discover PostgreSQL service and admin password in the runtime namespace
 * and set SCHEMA_MODE_* environment variables for schema-mode tests.
 */
export async function configureSchemaMode(
  kubeClient: KubeClient,
  namespace: string,
  releaseName: string,
  installMethod: "helm" | "operator",
): Promise<void> {
  const svcCandidates =
    installMethod === "operator"
      ? [`backstage-psql-${releaseName}`, `${releaseName}-postgresql`]
      : [`${releaseName}-postgresql`, `backstage-psql-${releaseName}`];

  let svcName: string | undefined;
  for (const candidate of svcCandidates) {
    try {
      await kubeClient.coreV1Api.readNamespacedService(candidate, namespace);
      svcName = candidate;
      break;
    } catch {
      // not found, try next
    }
  }

  if (svcName === undefined || svcName === "") {
    console.warn("No PostgreSQL service found in namespace — schema-mode tests will skip");
    return;
  }

  const secretCandidates =
    installMethod === "operator"
      ? [`backstage-psql-secret-${releaseName}`, `${releaseName}-postgresql`, "postgres-cred"]
      : [`${releaseName}-postgresql`, `backstage-psql-secret-${releaseName}`, "postgres-cred"];

  const passwordKeys = ["postgres-password", "POSTGRESQL_ADMIN_PASSWORD", "POSTGRES_PASSWORD"];

  let adminPassword: string | undefined;
  for (const sec of secretCandidates) {
    try {
      const result = await kubeClient.coreV1Api.readNamespacedSecret(sec, namespace);
      const data = result.body.data ?? {};
      for (const key of passwordKeys) {
        if (data[key]) {
          adminPassword = base64Decode(data[key]);
          break;
        }
      }
      if (adminPassword !== undefined && adminPassword !== "") break;
    } catch {
      // not found, try next
    }
  }

  if (adminPassword === undefined || adminPassword === "") {
    console.warn("Could not resolve PostgreSQL admin password — schema-mode tests will skip");
    return;
  }

  process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE = namespace;
  process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE = `svc/${svcName}`;
  process.env.SCHEMA_MODE_DB_ADMIN_USER = "postgres";
  process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD = adminPassword;
  process.env.SCHEMA_MODE_DB_PASSWORD =
    process.env.SCHEMA_MODE_DB_PASSWORD ?? getSchemaModeDefaultDbPassword();
  process.env.SCHEMA_MODE_DB_USER = process.env.SCHEMA_MODE_DB_USER ?? SCHEMA_MODE_DEFAULT_DB_USER;

  console.log(`Schema-mode env configured: port-forward svc/${svcName} in ${namespace}`);
}
