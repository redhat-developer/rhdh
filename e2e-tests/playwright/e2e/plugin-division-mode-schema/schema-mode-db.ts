/**
 * Database setup and connection utilities for schema mode E2E tests.
 */

import { expect } from "@playwright/test";
import { Client } from "pg";
import type { ClientConfig } from "pg";

export interface SchemaModeEnv {
  dbHost: string;
  dbAdminUser: string;
  dbAdminPassword: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

function quoteIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function escapePasswordLiteral(value: string): string {
  return String(value).replace(/'/g, "''");
}

export function normalizeDbHost(host: string): string {
  return host === "localhost" ? "127.0.0.1" : host;
}

async function connectWithRetry(config: ClientConfig): Promise<Client> {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = new Client(config);
    try {
      await client.connect();
      if (attempt > 1) {
        console.log(`✓ Connected after ${attempt} attempts`);
      }
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});

      if (attempt < maxRetries) {
        console.warn(
          `Connection attempt ${attempt}/${maxRetries} failed, retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  const errorMsg =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to connect after ${maxRetries} attempts: ${errorMsg}`,
  );
}

export async function connectWithSslFallback(
  config: ClientConfig,
): Promise<Client> {
  try {
    return await connectWithRetry(config);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (
      errorMsg.includes("no pg_hba.conf entry") &&
      (errorMsg.includes("no encryption") || errorMsg.includes("hostssl"))
    ) {
      console.log("Retrying connection with SSL...");
      const sslConfig = {
        ...config,
        ssl: { rejectUnauthorized: false },
      };
      return await connectWithRetry(sslConfig);
    }

    throw error;
  }
}

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
    dbUser: process.env.SCHEMA_MODE_DB_USER || "backstage_schema_user",
    dbPassword: dbPassword!,
  };
}

export async function connectAdminClient(
  config: Pick<SchemaModeEnv, "dbHost" | "dbAdminUser" | "dbAdminPassword">,
): Promise<Client> {
  return await connectWithSslFallback({
    host: normalizeDbHost(config.dbHost),
    port: 5432,
    user: config.dbAdminUser,
    password: config.dbAdminPassword,
    database: "postgres",
    connectionTimeoutMillis: 30000,
  });
}

export async function cleanupOldPluginDatabases(
  adminClient: Client,
): Promise<void> {
  const oldDbsResult = await adminClient.query<{ datname: string }>(`
    SELECT datname FROM pg_database
    WHERE datistemplate = false
      AND datname LIKE 'backstage_plugin_%'
  `);

  if (oldDbsResult.rows.length === 0) {
    console.log("✓ No old plugin databases to clean up");
    return;
  }

  console.log(
    `Found ${oldDbsResult.rows.length} old plugin databases, cleaning up...`,
  );

  for (const db of oldDbsResult.rows) {
    try {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [db.datname],
      );

      await adminClient.query(
        `DROP DATABASE IF EXISTS ${quoteIdent(db.datname)}`,
      );
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
  const { dbHost, dbAdminUser, dbAdminPassword, dbName, dbUser, dbPassword } =
    config;

  if (dbName !== "postgres") {
    await adminClient
      .query(`CREATE DATABASE ${quoteIdent(dbName)}`)
      .catch(() => {});
    console.log(`✓ Created/verified test database: ${dbName}`);
  } else {
    console.log(`✓ Using default postgres database`);
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
