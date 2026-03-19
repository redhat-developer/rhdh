/**
 * Shared database setup and helpers for plugin-division-mode schema E2E tests.
 * Used by both Helm and Operator specs to avoid duplication.
 */

import { expect } from "@playwright/test";
import { Client } from "pg";
import { quoteIdent } from "../../utils/postgres-config";

export { quoteIdent } from "../../utils/postgres-config";

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
 * Read schema-mode config from environment. Asserts required vars are set (use test.skip before calling if opt-in).
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
  const client = new Client({
    host: config.dbHost,
    port: 5432,
    user: config.dbAdminUser,
    password: config.dbAdminPassword,
    database: "postgres",
    connectionTimeoutMillis: 30000,
  });
  await client.connect();
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
  _dbName: string,
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
 * Create test database (if not postgres), create/update runtime user with restricted
 * role (NOSUPERUSER, NOCREATEDB), grant access to exactly one database, revoke
 * CONNECT on all others, and verify the runtime user can connect.
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

  // Create or update user with restricted role: no superuser, no createdb.
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

  // Restrict to single database: revoke CONNECT on all databases except the target.
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

  // Assert the runtime user cannot create databases (required for schema-mode test validity)
  await assertDbUserHasRestrictedPermissions(adminClient, dbUser, dbName);
  await adminClient.end();

  const dbClient = new Client({
    host: dbHost,
    port: 5432,
    user: dbAdminUser,
    password: dbAdminPassword,
    database: dbName,
    connectionTimeoutMillis: 30000,
  });
  await dbClient.connect();
  await dbClient.query(
    `GRANT CREATE ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
  );
  await dbClient.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(dbUser)}`);
  await dbClient.query(
    `GRANT CREATE ON SCHEMA public TO ${quoteIdent(dbUser)}`,
  );
  await dbClient.query(
    `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`,
  );
  await dbClient.query(`ALTER SCHEMA public OWNER TO ${quoteIdent(dbUser)}`);
  await dbClient.end();
  console.log("✓ Database setup complete");

  console.log("Verifying test database connection...");
  const testConnectionClient = new Client({
    host: dbHost,
    port: 5432,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    connectionTimeoutMillis: 10000,
  });
  try {
    await testConnectionClient.connect();
    await testConnectionClient.query("SELECT 1");
    await testConnectionClient.end();
    console.log("✓ Test database connection verified");
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
}
