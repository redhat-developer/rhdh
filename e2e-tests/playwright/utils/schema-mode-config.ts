/**
 * Utilities for testing pluginDivisionMode: schema feature.
 * Provides functions to set up a database with a limited-permissions user
 * and verify schema mode is working correctly.
 */

import { Client } from "pg";

/**
 * Set up a database and user with limited permissions for schema mode testing.
 * The user will only have permissions on a single database (no CREATEDB privilege).
 *
 * @param config - Database setup configuration
 * @param config.host - PostgreSQL host
 * @param config.adminUser - Admin user (must have CREATEDB and CREATEROLE)
 * @param config.adminPassword - Admin user password
 * @param config.databaseName - Name of the database to create
 * @param config.userName - Name of the limited-permissions user to create
 * @param config.userPassword - Password for the limited-permissions user
 */
export async function setupSchemaModeDatabase(config: {
  host: string;
  port?: string;
  adminUser: string;
  adminPassword: string;
  databaseName: string;
  userName: string;
  userPassword: string;
}): Promise<void> {
  console.log(
    `Setting up database ${config.databaseName} with user ${config.userName}...`,
  );

  // Connect as admin to set up database and user
  const adminClient = new Client({
    host: config.host,
    port: parseInt(config.port || "5432"),
    user: config.adminUser,
    password: config.adminPassword,
    database: "postgres",
    connectionTimeoutMillis: 30 * 1000,
  });

  try {
    await adminClient.connect();

    // Create database if it doesn't exist
    await adminClient.query(
      `CREATE DATABASE ${config.databaseName}`,
    ).catch((err) => {
      if (err.message.includes("already exists")) {
        console.log(`Database ${config.databaseName} already exists`);
      } else {
        throw err;
      }
    });

    // Create user if it doesn't exist
    await adminClient.query(
      `CREATE USER ${config.userName} WITH PASSWORD '${config.userPassword}'`,
    ).catch((err) => {
      if (err.message.includes("already exists")) {
        console.log(`User ${config.userName} already exists, updating password...`);
        await adminClient.query(
          `ALTER USER ${config.userName} WITH PASSWORD '${config.userPassword}'`,
        );
      } else {
        throw err;
      }
    });

    // Grant CONNECT privilege on the database
    await adminClient.query(
      `GRANT CONNECT ON DATABASE ${config.databaseName} TO ${config.userName}`,
    );

    // Connect to the target database to grant schema privileges
    await adminClient.end();
    const dbClient = new Client({
      host: config.host,
      port: parseInt(config.port || "5432"),
      user: config.adminUser,
      password: config.adminPassword,
      database: config.databaseName,
      connectionTimeoutMillis: 30 * 1000,
    });

    await dbClient.connect();

    // Grant CREATE SCHEMA privilege (required for schema mode)
    await dbClient.query(
      `GRANT CREATE ON DATABASE ${config.databaseName} TO ${config.userName}`,
    );

    // Grant usage on public schema (for initial connection)
    await dbClient.query(
      `GRANT USAGE ON SCHEMA public TO ${config.userName}`,
    );

    // Set default privileges so user can create objects in their schemas
    await dbClient.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${config.userName}`,
    );

    await dbClient.end();

    console.log(
      `Database ${config.databaseName} and user ${config.userName} set up successfully`,
    );
  } catch (error) {
    await adminClient.end().catch(() => {});
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to set up database: ${errorMsg}`);
  }
}

/**
 * Verify that plugin schemas were created in the database.
 *
 * @param credentials - Database connection credentials
 */
export async function verifySchemasExist(credentials: {
  host: string;
  port?: string;
  user: string;
  password: string;
  database: string;
}): Promise<void> {
  console.log("Verifying schemas were created...");

  const client = new Client({
    host: credentials.host,
    port: parseInt(credentials.port || "5432"),
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    connectionTimeoutMillis: 30 * 1000,
  });

  try {
    await client.connect();

    // Query for plugin schemas (excluding system schemas)
    const result = await client.query<{ schema_name: string }>(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
        AND schema_name NOT LIKE 'pg_%'
      ORDER BY schema_name
    `);

    const schemas = result.rows.map((row) => row.schema_name);

    // Expected plugin schemas
    const expectedSchemas = [
      "catalog",
      "scaffolder",
      "auth",
      "permission",
      "search",
      "techdocs",
    ];

    const foundSchemas = expectedSchemas.filter((schema) =>
      schemas.includes(schema),
    );

    if (foundSchemas.length === 0) {
      throw new Error(
        `No plugin schemas found. Found schemas: ${schemas.join(", ")}`,
      );
    }

    console.log(
      `Found ${foundSchemas.length} plugin schemas: ${foundSchemas.join(", ")}`,
    );
    console.log(`All schemas: ${schemas.join(", ")}`);

    // Verify we have at least a few key schemas
    if (foundSchemas.length < 3) {
      throw new Error(
        `Expected at least 3 plugin schemas, found only ${foundSchemas.length}`,
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to verify schemas: ${errorMsg}`);
  } finally {
    await client.end();
  }
}

/**
 * Verify that no separate plugin databases were created.
 * Should only see the test database and system databases.
 *
 * @param credentials - Database connection credentials (using postgres database)
 */
export async function verifyNoPluginDatabases(credentials: {
  host: string;
  port?: string;
  user: string;
  password: string;
}): Promise<void> {
  console.log("Verifying no separate plugin databases were created...");

  const client = new Client({
    host: credentials.host,
    port: parseInt(credentials.port || "5432"),
    user: credentials.user,
    password: credentials.password,
    database: "postgres",
    connectionTimeoutMillis: 30 * 1000,
  });

  try {
    await client.connect();

    // Query for databases
    const result = await client.query<{ datname: string }>(`
      SELECT datname 
      FROM pg_database 
      WHERE datistemplate = false
      ORDER BY datname
    `);

    const databases = result.rows.map((row) => row.datname);

    // Check for plugin databases (should not exist in schema mode)
    const pluginDatabases = databases.filter((db) =>
      db.startsWith("backstage_plugin_"),
    );

    if (pluginDatabases.length > 0) {
      throw new Error(
        `Found plugin databases that should not exist in schema mode: ${pluginDatabases.join(", ")}`,
      );
    }

    console.log(
      `No plugin databases found. All databases: ${databases.join(", ")}`,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to verify databases: ${errorMsg}`);
  } finally {
    await client.end();
  }
}
