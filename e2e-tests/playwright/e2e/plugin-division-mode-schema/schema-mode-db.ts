/**
 * Shared database setup and helpers for plugin-division-mode schema E2E tests.
 * Used by both Helm and Operator specs to avoid duplication.
 */

import { expect } from "@playwright/test";
import { Client } from "pg";
import type { ClientConfig } from "pg";

/** Quote a PostgreSQL identifier (safe against injection in dynamic SQL). */
function quoteIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/** Escape a string for use inside PostgreSQL single-quoted literal (doubles single quotes). */
function escapePasswordLiteral(value: string): string {
  return String(value).replace(/'/g, "''");
}

export interface SchemaModeEnv {
  dbHost: string;
  dbAdminUser: string;
  dbAdminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

/**
 * Normalize localhost to IPv4 loopback to avoid "::1" pg_hba mismatches on some clusters.
 */
function normalizeDbHost(host: string): string {
  return host === "localhost" ? "127.0.0.1" : host;
}

function shouldRetryWithSsl(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("no pg_hba.conf entry") &&
    (msg.includes("no encryption") || msg.includes("hostssl"))
  );
}

function isTransientConnectionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("Connection terminated unexpectedly") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("read ECONNRESET") ||
    msg.includes("write EPIPE")
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(
  config: ClientConfig,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<Client> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client: Client | undefined;
    try {
      client = new Client(config);
      await client.connect();
      if (attempt > 1) {
        console.log(`✓ Connected to PostgreSQL after ${attempt} attempts`);
      }
      return client;
    } catch (error) {
      lastError = error;
      if (client) {
        await client.end().catch(() => {});
      }

      if (!isTransientConnectionError(error)) {
        // Not a transient error, don't retry
        throw error;
      }

      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(
          `[WARNING] Connection attempt ${attempt}/${maxRetries} failed: ${errorMsg}`,
        );
        console.warn(`   Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  const errorMsg =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to connect after ${maxRetries} attempts. Last error: ${errorMsg}`,
  );
}

async function connectWithSslFallback(config: ClientConfig): Promise<Client> {
  try {
    return await connectWithRetry(config);
  } catch (error) {
    if (!shouldRetryWithSsl(error)) {
      throw error;
    }
  }

  // Retry with SSL
  console.log("Retrying connection with SSL...");
  const sslConfig = {
    ...config,
    // Port-forwarded managed DBs can require encryption and often use self-signed certs.
    ssl: { rejectUnauthorized: false },
  };
  return await connectWithRetry(sslConfig);
}

/**
 * Read schema-mode config from environment. Asserts required vars are set (call from skipped beforeAll if opt-in).
 */
export function getSchemaModeEnv(): SchemaModeEnv {
  const dbHost = process.env.SCHEMA_MODE_DB_HOST;
  const dbAdminPassword = process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD;
  const dbPassword = process.env.SCHEMA_MODE_DB_PASSWORD;
  expect(
    dbHost,
    "SCHEMA_MODE_DB_HOST must be set for schema-mode tests",
  ).toBeTruthy();
  expect(
    dbAdminPassword,
    "SCHEMA_MODE_DB_ADMIN_PASSWORD must be set for schema-mode tests",
  ).toBeTruthy();
  expect(
    dbPassword,
    "SCHEMA_MODE_DB_PASSWORD must be set for schema-mode tests",
  ).toBeTruthy();
  return {
    dbHost: dbHost!,
    dbAdminUser: process.env.SCHEMA_MODE_DB_ADMIN_USER || "postgres",
    dbAdminPassword: dbAdminPassword!,
    dbName: process.env.SCHEMA_MODE_DB_NAME || "postgres",
    dbUser: process.env.SCHEMA_MODE_DB_USER || "backstage_schema_user", // default; Helm spec overrides to bn_backstage
    dbPassword: dbPassword!,
  };
}

/**
 * Create a pg Client connected to the postgres database as admin.
 */
export async function connectAdminClient(
  config: Pick<SchemaModeEnv, "dbHost" | "dbAdminUser" | "dbAdminPassword">,
): Promise<Client> {
  const client = await connectWithSslFallback({
    host: normalizeDbHost(config.dbHost),
    port: 5432,
    user: config.dbAdminUser,
    password: config.dbAdminPassword,
    database: "postgres",
    connectionTimeoutMillis: 30000,
  });
  return client;
}

/**
 * Throw a connection error with port-forward troubleshooting for the given postgres pod.
 */
export function throwConnectionError(
  dbHost: string,
  namespace: string,
  postgresPodName: string,
  error: unknown,
): never {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const portForwardCmd = `oc port-forward -n ${namespace} ${postgresPodName} 5432:5432`;
  let troubleshooting = "";
  if (dbHost.includes("svc.cluster.local")) {
    troubleshooting =
      `Service name detected but connection failed.\n` +
      `If running from outside cluster, use port-forward instead:\n` +
      `  1. Start port-forward: ${portForwardCmd}\n` +
      `  2. Set: export SCHEMA_MODE_DB_HOST="localhost"`;
  } else if (dbHost === "localhost" || dbHost === "127.0.0.1") {
    troubleshooting =
      `Connection to localhost failed.\n` +
      `Ensure port-forward is running: ${portForwardCmd}`;
  } else {
    troubleshooting =
      `Connection failed. Try:\n` +
      `  1. Port-forward: ${portForwardCmd}\n` +
      `  2. Set: export SCHEMA_MODE_DB_HOST="localhost"`;
  }
  throw new Error(
    `Failed to connect to PostgreSQL at ${dbHost}:5432\n` +
      `Error: ${errorMsg}\n\n` +
      troubleshooting,
  );
}

/**
 * Drop old backstage_plugin_* databases from previous runs.
 */
export async function cleanupOldPluginDatabases(
  adminClient: Client,
): Promise<void> {
  const oldDbsResult = await adminClient.query<{ datname: string }>(`
    SELECT datname FROM pg_database 
    WHERE datistemplate = false 
      AND datname LIKE 'backstage_plugin_%'
  `);
  if (oldDbsResult.rows.length === 0) return;

  console.log(
    `Found ${oldDbsResult.rows.length} old plugin databases, cleaning up...`,
  );
  for (const db of oldDbsResult.rows) {
    try {
      await adminClient.query(
        `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `,
        [db.datname],
      );
      await adminClient.query(
        `DROP DATABASE IF EXISTS ${quoteIdent(db.datname)}`,
      );
      console.log(`  Dropped old database: ${db.datname}`);
    } catch (err) {
      console.warn(
        `  Could not drop database ${db.datname}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Assert that the DB user has restricted permissions: cannot create databases
 * (NOCREATEDB). This ensures the test runs with the same constraints as
 * environments where schema mode is required (e.g. managed DB with no CREATEDB).
 */
export async function assertDbUserHasRestrictedPermissions(
  adminClient: Client,
  dbUser: string,
): Promise<void> {
  const r = await adminClient.query<{ rolcreatedb: boolean }>(
    `SELECT rolcreatedb FROM pg_roles WHERE rolname = $1`,
    [dbUser],
  );
  if (r.rows.length === 0) {
    throw new Error(
      `Database user "${dbUser}" not found in pg_roles. Cannot assert restricted permissions.`,
    );
  }
  if (r.rows[0].rolcreatedb) {
    throw new Error(
      `Database user "${dbUser}" has CREATEDB privilege. Schema-mode tests require a user that cannot create databases (NOCREATEDB).`,
    );
  }
  console.log(
    `✓ Verified DB user "${dbUser}" has restricted permissions (NOCREATEDB)`,
  );
}

/**
 * Create test database (if not postgres), create/update runtime user, grant single-DB access,
 * and verify the runtime user can connect. Leaves adminClient open; caller must end it.
 */
export async function setupSchemaModeDatabase(
  adminClient: Client,
  config: SchemaModeEnv,
): Promise<void> {
  const { dbHost, dbAdminUser, dbAdminPassword, dbName, dbUser, dbPassword } =
    config;

  if (dbName !== "postgres") {
    await adminClient
      .query(`CREATE DATABASE ${quoteIdent(dbName)}`)
      .catch(() => {});
    console.log(`✓ Created/verified test database: ${dbName}`);
  } else {
    console.log(
      `✓ Using default postgres database (schemas will be created here)`,
    );
  }

  await adminClient
    .query(
      `CREATE USER ${quoteIdent(dbUser)} WITH PASSWORD '${escapePasswordLiteral(dbPassword)}' NOSUPERUSER NOCREATEDB`,
    )
    .catch(async (err: Error) => {
      if (err.message.includes("already exists")) {
        await adminClient.query(
          `ALTER USER ${quoteIdent(dbUser)} WITH PASSWORD '${escapePasswordLiteral(dbPassword)}' NOSUPERUSER NOCREATEDB`,
        );
      } else {
        throw err;
      }
    });

  // Restrict to single database: revoke CONNECT on all others
  const otherDbs = await adminClient.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> $1`,
    [dbName],
  );
  for (const row of otherDbs.rows) {
    try {
      await adminClient.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdent(row.datname)} FROM ${quoteIdent(dbUser)}`,
      );
    } catch {
      // Ignore (user may not have had CONNECT on this db)
    }
  }

  await adminClient.query(
    `GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
  );

  await assertDbUserHasRestrictedPermissions(adminClient, dbUser);
  await adminClient.end();

  // Connect to the target database to grant permissions
  let dbClient: Client;
  try {
    dbClient = await connectWithSslFallback({
      host: normalizeDbHost(dbHost),
      port: 5432,
      user: dbAdminUser,
      password: dbAdminPassword,
      database: dbName,
      connectionTimeoutMillis: 30000,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to connect to database ${dbName} as admin user.\n` +
        `Error: ${errorMsg}\n` +
        `Please verify the database exists and admin credentials are correct.`,
    );
  }

  // Grant permissions to the runtime user
  try {
    await dbClient.query(
      `GRANT CREATE ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
    );
    await dbClient.query(
      `GRANT USAGE ON SCHEMA public TO ${quoteIdent(dbUser)}`,
    );
    await dbClient.query(
      `GRANT CREATE ON SCHEMA public TO ${quoteIdent(dbUser)}`,
    );
    await dbClient.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
    );
    await dbClient.query(`ALTER SCHEMA public OWNER TO ${quoteIdent(dbUser)}`);
    console.log("✓ Database permissions configured");
  } finally {
    await dbClient.end();
  }

  console.log("✓ Database setup complete");

  // Verify the runtime user can connect
  console.log("Verifying test database connection...");
  let testConnectionClient: Client;
  try {
    testConnectionClient = await connectWithSslFallback({
      host: normalizeDbHost(dbHost),
      port: 5432,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      connectionTimeoutMillis: 10000,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Test database connection failed. This means RHDH pods will also fail to connect.\n` +
        `Error: ${errorMsg}\n` +
        `Please verify:\n` +
        `  - Database ${dbName} exists\n` +
        `  - User ${dbUser} has proper permissions\n` +
        `  - Password is correct`,
    );
  }

  try {
    await testConnectionClient.query("SELECT 1");
    console.log("✓ Test database connection verified");
  } finally {
    await testConnectionClient.end();
  }
}
