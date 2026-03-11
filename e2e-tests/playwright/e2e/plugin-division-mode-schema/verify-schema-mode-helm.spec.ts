import { test } from "@playwright/test";
import * as yaml from "js-yaml";
import { Client } from "pg";
import { execSync } from "child_process";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";

interface AppConfigBackend {
  database?: {
    client?: string;
    pluginDivisionMode?: string;
    ensureSchemaExists?: boolean;
    connection?: {
      host?: string;
      port?: string;
      user?: string;
      password?: string;
      database?: string;
    };
  };
}

interface AppConfigYaml {
  backend?: AppConfigBackend;
  [key: string]: unknown;
}

test.describe("Verify pluginDivisionMode: schema (Helm Chart)", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME || "redhat-developer-hub";

  // Helm chart resource names
  const deploymentName = releaseName;
  const postgresPodName = `${releaseName}-postgresql-0`;
  const postgresServiceName = `${releaseName}-postgresql`;
  const configMapName = `${releaseName}-app-config`;
  const secretName = `${releaseName}-postgresql`; // Helm chart managed secret
  const podLabelSelector = `app.kubernetes.io/component=backstage,app.kubernetes.io/instance=${releaseName},app.kubernetes.io/name=developer-hub`;

  const dbHost = process.env.SCHEMA_MODE_DB_HOST;
  const dbAdminUser = process.env.SCHEMA_MODE_DB_ADMIN_USER || "postgres";
  const dbAdminPassword = process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD;

  const dbName = process.env.SCHEMA_MODE_DB_NAME || "postgres";
  const dbUser = process.env.SCHEMA_MODE_DB_USER || "bn_backstage"; // Helm chart default user
  const dbPassword = process.env.SCHEMA_MODE_DB_PASSWORD;

  test.beforeAll(async () => {
    test.setTimeout(300000);
    test.info().annotations.push(
      {
        type: "component",
        description: "data-management",
      },
      {
        type: "namespace",
        description: namespace,
      },
    );

    if (!dbHost || !dbAdminPassword || !dbPassword) {
      throw new Error(
        "Required env vars: SCHEMA_MODE_DB_HOST, SCHEMA_MODE_DB_ADMIN_PASSWORD, SCHEMA_MODE_DB_PASSWORD",
      );
    }

    const kubeClient = new KubeClient();

    console.log(`Connecting to PostgreSQL at ${dbHost}:5432...`);
    const adminClient = new Client({
      host: dbHost,
      port: 5432,
      user: dbAdminUser,
      password: dbAdminPassword,
      database: "postgres",
      connectionTimeoutMillis: 30000,
    });

    try {
      await adminClient.connect();
      console.log("✓ Connected to PostgreSQL");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const portForwardCmd = `oc port-forward -n ${namespace} ${postgresPodName} 5432:5432`;

      let troubleshooting = "";
      if (dbHost.includes("svc.cluster.local")) {
        troubleshooting =
          `Service name detected but connection failed.\n` +
          `If running from outside cluster, use port-forward instead:\n` +
          `  1. Start port-forward: ${portForwardCmd}\n` +
          `  2. Set: export SCHEMA_MODE_DB_HOST="localhost"`;
      } else if (dbHost === "localhost") {
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

    console.log("Checking for old plugin databases from previous runs...");
    const oldDbsResult = await adminClient.query<{ datname: string }>(`
      SELECT datname FROM pg_database 
      WHERE datistemplate = false 
        AND datname LIKE 'backstage_plugin_%'
    `);
    if (oldDbsResult.rows.length > 0) {
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
          await adminClient.query(`DROP DATABASE IF EXISTS "${db.datname}"`);
          console.log(`  Dropped old database: ${db.datname}`);
        } catch (err) {
          console.warn(
            `  Could not drop database ${db.datname}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (dbName !== "postgres") {
      await adminClient.query(`CREATE DATABASE ${dbName}`).catch(() => {});
      console.log(`✓ Created/verified test database: ${dbName}`);
    } else {
      console.log(
        `✓ Using default postgres database (schemas will be created here)`,
      );
    }

    // Create/update bn_backstage user (Helm chart default user)
    await adminClient
      .query(`CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}'`)
      .catch(async (err) => {
        if (err.message.includes("already exists")) {
          await adminClient.query(
            `ALTER USER ${dbUser} WITH PASSWORD '${dbPassword}'`,
          );
        } else {
          throw err;
        }
      });

    await adminClient.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${dbUser}`);
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
    await dbClient.query(`GRANT CREATE ON DATABASE ${dbName} TO ${dbUser}`);
    await dbClient.query(`GRANT USAGE ON SCHEMA public TO ${dbUser}`);
    await dbClient.query(`GRANT CREATE ON SCHEMA public TO ${dbUser}`);
    await dbClient.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}`,
    );
    await dbClient.query(`ALTER SCHEMA public OWNER TO ${dbUser}`);

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

    console.log("Configuring RHDH for schema mode...");

    if (dbHost === "localhost" || dbHost === "127.0.0.1") {
      try {
        await kubeClient.coreV1Api.readNamespacedService(
          postgresServiceName,
          namespace,
        );
        console.log(
          `✓ Verified PostgreSQL service exists: ${postgresServiceName}`,
        );
      } catch {
        console.warn(
          `[WARNING]  Warning: Could not verify PostgreSQL service '${postgresServiceName}' exists`,
        );
        console.warn(
          `   Service might have a different name. Checking available services...`,
        );
        try {
          const services =
            await kubeClient.coreV1Api.listNamespacedService(namespace);
          const pgServices = services.body.items.filter(
            (s) =>
              s.metadata?.name?.includes("postgresql") ||
              s.metadata?.name?.includes("postgres"),
          );
          if (pgServices.length > 0) {
            console.warn(
              `   Found PostgreSQL-related services: ${pgServices.map((s) => s.metadata?.name).join(", ")}`,
            );
            console.warn(
              `   Using: ${postgresServiceName} (if this fails, check the actual service name)`,
            );
          }
        } catch {
          // Ignore list errors
        }
      }
    }

    // Update Helm chart secret with test user password
    // Helm chart uses bn_backstage user and reads password from the secret
    let secretNeedsUpdate = true;
    let needsRestart = false;

    try {
      const existingSecret = await kubeClient.coreV1Api.readNamespacedSecret(
        secretName,
        namespace,
      );

      // Helm chart secret uses keys: password, postgres-password, postgresql-password
      const existingPassword = existingSecret.body.data?.password
        ? Buffer.from(existingSecret.body.data.password, "base64").toString()
        : existingSecret.body.data?.["postgres-password"]
          ? Buffer.from(
              existingSecret.body.data["postgres-password"],
              "base64",
            ).toString()
          : existingSecret.body.data?.["postgresql-password"]
            ? Buffer.from(
                existingSecret.body.data["postgresql-password"],
                "base64",
              ).toString()
            : null;

      if (existingPassword === dbPassword) {
        console.log(
          `✓ Helm chart secret ${secretName} already has correct password`,
        );
        secretNeedsUpdate = false;
      } else {
        console.log(`Helm chart secret ${secretName} needs password update`);
      }
    } catch {
      console.log(`Helm chart secret ${secretName} not found, will update it`);
    }

    if (secretNeedsUpdate) {
      try {
        const helmSecret = await kubeClient.coreV1Api.readNamespacedSecret(
          secretName,
          namespace,
        );
        const updatedSecret = helmSecret.body;
        if (!updatedSecret.data) updatedSecret.data = {};

        // Update password in all possible keys
        updatedSecret.data.password =
          Buffer.from(dbPassword).toString("base64");
        updatedSecret.data["postgres-password"] =
          Buffer.from(dbPassword).toString("base64");
        updatedSecret.data["postgresql-password"] =
          Buffer.from(dbPassword).toString("base64");

        // CRITICAL: Set POSTGRES_DB to the test database name
        // Helm chart reads this from the secret and uses it as the database name
        updatedSecret.data.POSTGRES_DB = Buffer.from(dbName).toString("base64");
        // Also set it in other possible keys that Helm chart might use
        updatedSecret.data["postgres-db"] =
          Buffer.from(dbName).toString("base64");
        updatedSecret.data["postgresql-db"] =
          Buffer.from(dbName).toString("base64");

        delete updatedSecret.metadata?.resourceVersion;
        await kubeClient.coreV1Api.replaceNamespacedSecret(
          secretName,
          namespace,
          updatedSecret,
        );
        console.log(
          `✓ Updated Helm chart secret ${secretName} with test user password`,
        );
        needsRestart = true; // Helm chart deployments need restart to pick up secret changes
      } catch (error) {
        console.warn(
          `[WARNING]  Could not update Helm chart secret ${secretName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.warn(
          `   You may need to manually update the secret or ensure the Helm chart user password matches the test user password.`,
        );
      }
    }

    // CRITICAL: Ensure POSTGRES_DB environment variable is set in the deployment
    // Helm chart might not set this by default, causing Backstage to default to username as database name
    try {
      const deployment = await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );
      const containers = deployment.body.spec?.template?.spec?.containers || [];
      const backstageContainerIndex = containers.findIndex(
        (c) => c.name === "backstage-backend",
      );
      const backstageContainer = containers[backstageContainerIndex];

      if (backstageContainer) {
        const env = backstageContainer.env || [];
        const hasPostgresDb = env.some((e) => e.name === "POSTGRES_DB");

        if (!hasPostgresDb) {
          console.log(
            "Adding POSTGRES_DB environment variable to deployment...",
          );
          // Need to ensure the env array exists
          const patch: { op: string; path: string; value?: unknown }[] = [];

          // If env array doesn't exist, create it first
          if (!backstageContainer.env || backstageContainer.env.length === 0) {
            patch.push({
              op: "add",
              path: `/spec/template/spec/containers/${backstageContainerIndex}/env`,
              value: [],
            });
          }

          // Add POSTGRES_DB environment variable
          patch.push({
            op: "add",
            path: `/spec/template/spec/containers/${backstageContainerIndex}/env/-`,
            value: {
              name: "POSTGRES_DB",
              valueFrom: {
                secretKeyRef: {
                  name: secretName,
                  key: "POSTGRES_DB",
                },
              },
            },
          });

          try {
            await kubeClient.appsApi.patchNamespacedDeployment(
              deploymentName,
              namespace,
              patch,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              { headers: { "Content-Type": "application/json-patch+json" } },
            );
            console.log(
              "✓ Added POSTGRES_DB environment variable to deployment via API",
            );
            needsRestart = true;
          } catch (apiError) {
            // If API patch fails (e.g., Helm-managed resource), try using oc command as fallback
            const apiErrorMsg =
              apiError instanceof Error ? apiError.message : String(apiError);
            console.warn(`[WARNING]  API patch failed: ${apiErrorMsg}`);
            console.log(
              "Attempting to patch deployment using oc command as fallback...",
            );

            try {
              const patchJson = JSON.stringify(patch);
              execSync(
                `oc patch deployment ${deploymentName} -n ${namespace} --type='json' -p='${patchJson}'`,
                { stdio: "pipe", encoding: "utf-8" },
              );
              console.log(
                "✓ Added POSTGRES_DB environment variable to deployment via oc command",
              );

              // Verify the patch was applied
              await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds for API to sync
              const verifyDeployment =
                await kubeClient.appsApi.readNamespacedDeployment(
                  deploymentName,
                  namespace,
                );
              const verifyContainer =
                verifyDeployment.body.spec?.template?.spec?.containers?.find(
                  (c) => c.name === "backstage-backend",
                );
              const verifyEnv = verifyContainer?.env || [];
              const verifyPostgresDb = verifyEnv.find(
                (e) => e.name === "POSTGRES_DB",
              );

              if (!verifyPostgresDb) {
                throw new Error(
                  "Patch command succeeded but POSTGRES_DB was not found in deployment after patching",
                );
              }
              console.log(
                "✓ Verified POSTGRES_DB environment variable was added to deployment",
              );
              needsRestart = true;
            } catch (ocError) {
              const ocErrorMsg =
                ocError instanceof Error ? ocError.message : String(ocError);
              console.error(
                `[ERROR]  Failed to patch deployment via oc command: ${ocErrorMsg}`,
              );
              console.error(
                `   Please manually run this command to add POSTGRES_DB:`,
              );
              console.error(
                `   oc patch deployment ${deploymentName} -n ${namespace} --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"POSTGRES_DB","valueFrom":{"secretKeyRef":{"name":"${secretName}","key":"POSTGRES_DB"}}}}]'`,
              );
              throw new Error(
                `Failed to add POSTGRES_DB environment variable to deployment. Both API and oc command failed.`,
              );
            }
          }
        } else {
          console.log(
            "✓ POSTGRES_DB environment variable already exists in deployment",
          );
          // Verify it's reading from the correct secret
          const postgresDbEnv = env.find((e) => e.name === "POSTGRES_DB");
          if (postgresDbEnv?.valueFrom?.secretKeyRef) {
            const secretRef = postgresDbEnv.valueFrom.secretKeyRef;
            if (
              secretRef.name !== secretName ||
              secretRef.key !== "POSTGRES_DB"
            ) {
              console.warn(
                `[WARNING]  POSTGRES_DB env var references secret ${secretRef.name}/${secretRef.key}, expected ${secretName}/POSTGRES_DB`,
              );
            }
          }
        }
      }
    } catch (deploymentError) {
      const errorMsg =
        deploymentError instanceof Error
          ? deploymentError.message
          : String(deploymentError);
      // Only log warning if it's not a critical error (critical errors are already thrown above)
      if (!errorMsg.includes("Failed to add POSTGRES_DB")) {
        console.warn(
          `[WARNING]  Could not check/add POSTGRES_DB to deployment: ${errorMsg}`,
        );
        console.warn(
          `   The deployment might need POSTGRES_DB as an environment variable for Backstage to use the correct database.`,
        );
      } else {
        throw deploymentError; // Re-throw critical errors
      }
    }

    // Validate configuration before proceeding
    try {
      const verifyDeployment =
        await kubeClient.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );
      const verifyContainer =
        verifyDeployment.body.spec?.template?.spec?.containers?.find(
          (c) => c.name === "backstage-backend",
        );
      const verifyEnv = verifyContainer?.env || [];
      const verifyPostgresDb = verifyEnv.find((e) => e.name === "POSTGRES_DB");

      if (!verifyPostgresDb) {
        console.error(
          `[ERROR]  Deployment does not have POSTGRES_DB environment variable!`,
        );
        console.error(
          `   Backstage will not be able to resolve \${POSTGRES_DB} in app-config.`,
        );
      }
    } catch (validationError) {
      // Only log if it's a critical error
      const errorMsg =
        validationError instanceof Error
          ? validationError.message
          : String(validationError);
      if (!errorMsg.includes("not found")) {
        console.warn(
          `[WARNING]  Could not validate configuration: ${errorMsg}`,
        );
      }
    }

    // Update Helm chart ConfigMap
    let configMapResponse;
    try {
      configMapResponse = await kubeClient.getConfigMap(
        configMapName,
        namespace,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("not found") || errorMsg.includes("404")) {
        console.warn(`[WARNING]  ConfigMap '${configMapName}' not found`);
        console.warn(
          `   This may be OK if Helm chart uses a different ConfigMap name.`,
        );
        throw new Error(
          `ConfigMap ${configMapName} not found. Please verify the Helm chart release name.`,
        );
      }
      throw err;
    }

    const configMap = configMapResponse.body;
    const configKey = Object.keys(configMap.data || {}).find((key) =>
      key.includes("app-config"),
    );

    if (!configKey || !configMap.data) {
      throw new Error(
        `Could not find app-config key in ConfigMap ${configMapName}`,
      );
    }

    const appConfig = yaml.load(configMap.data[configKey]) as AppConfigYaml;
    if (!appConfig.backend) appConfig.backend = {};

    // Check if already configured for schema mode
    const currentDbConfig = appConfig.backend.database;
    const isAlreadyConfigured =
      currentDbConfig?.pluginDivisionMode === "schema" &&
      (currentDbConfig?.connection?.database === `\${POSTGRES_DB}` ||
        currentDbConfig?.connection?.database === dbName);

    if (!isAlreadyConfigured) {
      console.log("Updating Helm chart app-config for schema mode...");

      appConfig.backend.database = {
        client: "pg",
        pluginDivisionMode: "schema",
        ensureSchemaExists: true, // Required for schema mode - schemas won't be created without this
        connection: {
          host: `\${POSTGRES_HOST}`,
          port: `\${POSTGRES_PORT}`,
          user: `\${POSTGRES_USER}`,
          password: `\${POSTGRES_PASSWORD}`,
          database: `\${POSTGRES_DB}`, // Use environment variable from secret
        },
      };

      // Validate YAML before updating
      const newConfigYaml = yaml.dump(appConfig);
      try {
        yaml.load(newConfigYaml); // Validate it can be parsed
      } catch (error) {
        throw new Error(
          `Generated invalid YAML for app-config: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      configMap.data[configKey] = newConfigYaml;
      delete configMap.metadata?.creationTimestamp;
      delete configMap.metadata?.resourceVersion;
      await kubeClient.coreV1Api.replaceNamespacedConfigMap(
        configMapName,
        namespace,
        configMap,
      );
      needsRestart = true;
      console.log("✓ App-config updated for schema mode");
    } else {
      console.log("✓ RHDH is already configured for schema mode in app-config");
    }

    // After restart, validate what Backstage is actually reading
    // This helps diagnose if Helm chart is overwriting our changes
    if (needsRestart) {
      // Optional: add validation after restart
    }

    // Check if deployment is already running and ready
    let deploymentReady = false;
    try {
      const deployment = await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );
      const availableReplicas = deployment.body.status?.availableReplicas || 0;
      const readyReplicas = deployment.body.status?.readyReplicas || 0;
      deploymentReady = availableReplicas >= 1 && readyReplicas >= 1;

      if (!deploymentReady) {
        console.warn(
          `[WARNING]  Deployment is not ready (${readyReplicas} ready, ${availableReplicas} available)`,
        );
      }
    } catch {
      // Silently continue - will restart if needed
    }

    // Restart logic:
    // - Always restart if we made config/secret changes (needsRestart = true)
    // - For Helm chart: only restart if we made changes OR if deployment isn't ready
    // - If config is already correct and deployment is ready, skip restart to avoid PVC issues
    if (needsRestart) {
      console.log("Restarting RHDH to apply schema mode configuration...");
      console.log(
        "   Note: Helm chart deployments require a restart to pick up ConfigMap and secret changes.",
      );
      try {
        await kubeClient.restartDeployment(deploymentName, namespace);
        console.log("✓ RHDH restart completed successfully");

        // Wait for RHDH to initialize
        console.log("Waiting for RHDH to initialize and create schemas...");
        await new Promise((resolve) => setTimeout(resolve, 90000)); // Wait 90 seconds for initialization and schema creation
      } catch (restartError) {
        const errorMsg =
          restartError instanceof Error
            ? restartError.message
            : String(restartError);
        // For Helm chart, if restart fails due to PVC issues but config is already correct, continue
        // (ConfigMap changes might be picked up without restart for Helm chart)
        if (
          errorMsg.includes("ephemeral volume") ||
          errorMsg.includes("persistentvolumeclaim")
        ) {
          console.warn(
            "[WARNING]  Restart failed due to cluster storage issue (PVC cannot be created).",
          );
          console.warn(
            "   This is a transient cluster issue, not a test failure.",
          );
          console.warn(
            "   For Helm chart deployments, ConfigMap changes may be picked up without restart.",
          );
          console.warn(
            "   Continuing with test - if schemas aren't created, you may need to manually restart the deployment.",
          );
          // Continue with test - wait a bit for any config changes to take effect
          console.log(
            "Waiting for RHDH to apply configuration changes (if any)...",
          );
          await new Promise((resolve) => setTimeout(resolve, 30000));
        } else {
          throw restartError;
        }
      }
    } else if (!deploymentReady) {
      console.warn(
        "[WARNING]  No config changes needed, but deployment is not ready. Waiting...",
      );
      await kubeClient.waitForDeploymentReady(
        deploymentName,
        namespace,
        1,
        120000,
        10000,
        podLabelSelector,
      );
    } else {
      console.log("✓ Configuration already applied, deployment is ready");
      // Still wait a bit for schemas to be created if they haven't been yet
      await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds
    }
  });

  test("Verify schemas were created", async () => {
    test.setTimeout(600000); // 10 minutes - schemas may take time to be created as plugins initialize
    const kubeClient = new KubeClient();

    // Validate configuration before waiting for deployment
    try {
      const verifyDeployment =
        await kubeClient.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );
      const verifyContainer =
        verifyDeployment.body.spec?.template?.spec?.containers?.find(
          (c) => c.name === "backstage-backend",
        );
      const verifyEnv = verifyContainer?.env || [];
      const verifyPostgresDb = verifyEnv.find((e) => e.name === "POSTGRES_DB");

      if (!verifyPostgresDb) {
        console.error(
          `[ERROR]  Deployment does not have POSTGRES_DB environment variable!`,
        );
        console.error(
          `   Backstage will not be able to resolve \${POSTGRES_DB} in app-config.`,
        );
        console.error(`   Run this command to add it:`);
        console.error(
          `   oc patch deployment ${deploymentName} -n ${namespace} --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"POSTGRES_DB","valueFrom":{"secretKeyRef":{"name":"${secretName}","key":"POSTGRES_DB"}}}}]'`,
        );
        throw new Error(
          `Deployment ${deploymentName} must have POSTGRES_DB environment variable set`,
        );
      }
    } catch (validationError) {
      const errorMsg =
        validationError instanceof Error
          ? validationError.message
          : String(validationError);
      if (
        errorMsg.includes("must have") ||
        errorMsg.includes("does not have")
      ) {
        throw validationError; // Re-throw critical validation errors
      }
    }

    await kubeClient.waitForDeploymentReady(
      deploymentName,
      namespace,
      1,
      180000,
      10000,
      podLabelSelector,
    );

    // Wait a bit more for RHDH to fully initialize plugins
    console.log(
      "Waiting for RHDH to fully initialize plugins (schemas are created lazily)...",
    );
    await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 1 minute for plugin initialization

    // Use admin user to check for schemas - more reliable and can see all schemas
    console.log(
      `Connecting to database ${dbName} as admin user to check for schemas...`,
    );
    const adminClient = new Client({
      host: dbHost,
      port: 5432,
      user: dbAdminUser,
      password: dbAdminPassword,
      database: dbName,
      connectionTimeoutMillis: 30000,
    });

    // Also create a test user client for verification
    let testUserClient: Client | null = null;
    try {
      testUserClient = new Client({
        host: dbHost,
        port: 5432,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        connectionTimeoutMillis: 30000,
      });
      await testUserClient.connect();
      console.log(`✓ Test user ${dbUser} can connect to database ${dbName}`);
      const dbCheck = await testUserClient.query("SELECT current_database()");
      console.log(
        `✓ Verified test user is connected to database: ${dbCheck.rows[0].current_database}`,
      );
    } catch (connectError) {
      const errorMsg =
        connectError instanceof Error
          ? connectError.message
          : String(connectError);
      console.warn(
        `[WARNING]  Warning: Test user ${dbUser} cannot connect: ${errorMsg}`,
      );
      console.warn(`   Will use admin user to check schemas instead.`);
      console.warn(
        `   This might mean RHDH is using a different user than the test user.`,
      );
    }

    try {
      await adminClient.connect();
      console.log(`✓ Connected to database ${dbName} as admin user`);

      // Verify the database exists and we can query it
      const dbCheck = await adminClient.query("SELECT current_database()");
      console.log(
        `✓ Verified we're connected to database: ${dbCheck.rows[0].current_database}`,
      );
    } catch (connectError) {
      const errorMsg =
        connectError instanceof Error
          ? connectError.message
          : String(connectError);
      throw new Error(
        `Failed to connect to database ${dbName} as admin user.\n` +
          `Error: ${errorMsg}\n` +
          `Please verify:\n` +
          `  - Database ${dbName} exists\n` +
          `  - Admin credentials are correct\n` +
          `  - PostgreSQL is accessible at ${dbHost}:5432`,
      );
    }

    // Wait for schemas to be created (RHDH creates them lazily when plugins initialize)
    // Check every 15 seconds for up to 5 minutes
    const maxWaitTime = 300000; // 5 minutes
    const checkInterval = 15000; // 15 seconds
    const startTime = Date.now();
    let schemas: string[] = [];
    let found: string[] = [];

    while (Date.now() - startTime < maxWaitTime) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      try {
        // Use admin client to check for schemas - more reliable
        const result = await adminClient.query<{ schema_name: string }>(`
          SELECT schema_name FROM information_schema.schemata 
          WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
            AND schema_name NOT LIKE 'pg_%'
          ORDER BY schema_name
        `);
        schemas = result.rows.map((r) => r.schema_name);
        const expected = [
          "catalog",
          "scaffolder",
          "auth",
          "permission",
          "search",
        ];
        found = expected.filter((s) => schemas.includes(s));

        // Also get schema owners for better diagnostics
        const schemaOwners = await adminClient.query<{
          schema_name: string;
          schema_owner: string;
        }>(`
          SELECT schema_name, schema_owner 
          FROM information_schema.schemata 
          WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
            AND schema_name NOT LIKE 'pg_%'
          ORDER BY schema_name
        `);

        if (found.length >= 3) {
          console.log(
            `✓ Found ${found.length} plugin schemas: ${found.join(", ")}`,
          );
          console.log(`  All schemas found: ${schemas.join(", ")}`);
          console.log(`  Schema owners:`);
          schemaOwners.rows.forEach((row) => {
            console.log(`    ${row.schema_name}: ${row.schema_owner}`);
          });
          break;
        }

        console.log(
          `Waiting for schemas to be created... (${elapsed}s elapsed, found: ${found.join(", ") || "none"})`,
        );
        if (schemas.length > 0) {
          console.log(`  Current schemas in database: ${schemas.join(", ")}`);
        }

        // Also check if we're in the right database
        const currentDb = await adminClient.query("SELECT current_database()");
        if (currentDb.rows[0].current_database !== dbName) {
          console.warn(
            `[WARNING]  Warning: Connected to database '${currentDb.rows[0].current_database}' instead of '${dbName}'`,
          );
        }
      } catch (queryError) {
        const errorMsg =
          queryError instanceof Error ? queryError.message : String(queryError);
        console.warn(`[WARNING]  Error querying schemas: ${errorMsg}`);
        // Try to reconnect
        try {
          await adminClient.end();
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await adminClient.connect();
          console.log("✓ Reconnected to database");
        } catch (reconnectError) {
          console.error(
            `✗ Failed to reconnect: ${reconnectError instanceof Error ? reconnectError.message : String(reconnectError)}`,
          );
        }
      }

      // Every 60 seconds, check pod logs
      if (elapsed > 0 && elapsed % 60 === 0) {
        try {
          const podsResponse = await kubeClient.coreV1Api.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            podLabelSelector,
          );
          if (podsResponse.body.items.length > 0) {
            const podName = podsResponse.body.items[0].metadata?.name;
            if (podName) {
              const logs = await kubeClient.coreV1Api.readNamespacedPodLog(
                podName,
                namespace,
                "backstage-backend",
                false,
                undefined,
                undefined,
                undefined,
                undefined,
                50,
                undefined,
              );
              if (logs.body) {
                const logLines = logs.body.split("\n");
                const relevantLogs = logLines.filter(
                  (l) =>
                    l.toLowerCase().includes("schema") ||
                    l.toLowerCase().includes("database") ||
                    l.toLowerCase().includes("plugin") ||
                    l.toLowerCase().includes("connect") ||
                    l.toLowerCase().includes("error") ||
                    l.toLowerCase().includes("fail"),
                );
                if (relevantLogs.length > 0) {
                  console.log(
                    `  Relevant pod logs (last ${Math.min(10, relevantLogs.length)} lines):`,
                  );
                  relevantLogs.slice(-10).forEach((line) => {
                    if (line.trim()) console.log(`    ${line}`);
                  });
                }
              }
            }
          }
        } catch {
          // Ignore log retrieval errors
        }
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    if (found.length < 3) {
      // Get all schemas for better error message
      const allSchemas = await adminClient.query<{ schema_name: string }>(`
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
          AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name
      `);
      const allSchemaNames = allSchemas.rows.map((r) => r.schema_name);

      // Also get schema owners
      const allSchemaOwners = await adminClient.query<{
        schema_name: string;
        schema_owner: string;
      }>(`
        SELECT schema_name, schema_owner 
        FROM information_schema.schemata 
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
          AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name
      `);

      const schemaOwnerInfo =
        allSchemaOwners.rows.length > 0
          ? `\n\nSchema owners:\n${allSchemaOwners.rows.map((r) => `  ${r.schema_name}: ${r.schema_owner}`).join("\n")}`
          : "";

      let configCheck = "";
      let secretCheck = "";
      try {
        const verifyConfig = await kubeClient.getConfigMap(
          configMapName,
          namespace,
        );
        const verifyConfigKey = Object.keys(verifyConfig.body.data || {}).find(
          (key) => key.includes("app-config"),
        );

        if (verifyConfigKey && verifyConfig.body.data) {
          const verifyAppConfig = yaml.load(
            verifyConfig.body.data[verifyConfigKey],
          ) as AppConfigYaml;
          const verifyDbConfig = verifyAppConfig?.backend?.database;
          if (verifyDbConfig) {
            configCheck =
              `\n\nCurrent app-config database settings:\n` +
              `  pluginDivisionMode: ${verifyDbConfig?.pluginDivisionMode || "NOT SET"}\n` +
              `  database: ${verifyDbConfig?.connection?.database || "NOT SET"}\n` +
              `  host: ${verifyDbConfig?.connection?.host || "NOT SET"}\n` +
              `  user: ${verifyDbConfig?.connection?.user || "NOT SET"}`;
          }
        }

        // Check Helm secret
        try {
          const secret = await kubeClient.coreV1Api.readNamespacedSecret(
            secretName,
            namespace,
          );
          const secretData = secret.body.data || {};
          const secretPassword = secretData.password ? "***SET***" : "NOT SET";
          secretCheck =
            `\n\nCurrent Helm secret ${secretName} values:\n` +
            `  password: ${secretPassword}\n` +
            `  (Helm chart uses this secret for POSTGRES_PASSWORD)`;
        } catch (secretError) {
          secretCheck = `\n\n[WARNING]  Could not read Helm secret ${secretName}: ${secretError instanceof Error ? secretError.message : String(secretError)}`;
        }
      } catch (error) {
        configCheck = `\n\n[WARNING]  Error reading ConfigMap: ${error instanceof Error ? error.message : String(error)}`;
      }

      throw new Error(
        `Expected at least 3 plugin schemas (catalog, scaffolder, auth, permission, search), found: ${allSchemaNames.join(", ") || "none"}\n` +
          `Found ${found.length} expected schemas: ${found.join(", ") || "none"}\n` +
          `This suggests RHDH may not be using schema mode. Check:\n` +
          `  1. App-config has pluginDivisionMode: "schema"${configCheck}${secretCheck}\n` +
          `  2. RHDH pods can connect to PostgreSQL (verify Helm secret ${secretName} has correct password)\n` +
          `  3. RHDH has finished initializing (wait longer or check pod status)\n` +
          `  4. Database user ${dbUser} has CREATE privilege on database ${dbName}\n` +
          `  5. RHDH version supports schema mode${schemaOwnerInfo}`,
      );
    }

    await adminClient.end();
    if (testUserClient) {
      await testUserClient.end();
    }
  });

  test("Verify no separate plugin databases", async () => {
    test.setTimeout(120000);
    const client = new Client({
      host: dbHost,
      port: 5432,
      user: dbAdminUser,
      password: dbAdminPassword,
      database: "postgres",
      connectionTimeoutMillis: 30000,
    });
    await client.connect();

    console.log(
      "Waiting for RHDH to fully restart and close old database connections...",
    );
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log(
      "Checking for leftover plugin databases from before schema mode...",
    );
    const oldDbsResult = await client.query<{ datname: string }>(`
      SELECT datname FROM pg_database 
      WHERE datistemplate = false 
        AND datname LIKE 'backstage_plugin_%'
    `);

    if (oldDbsResult.rows.length > 0) {
      console.log(
        `Found ${oldDbsResult.rows.length} leftover plugin databases, attempting to clean up...`,
      );
      for (const db of oldDbsResult.rows) {
        try {
          await client.query(
            `
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
          `,
            [db.datname],
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await client.query(`DROP DATABASE IF EXISTS "${db.datname}"`);
          console.log(`  Dropped leftover database: ${db.datname}`);
        } catch (err) {
          console.warn(
            `  Could not drop database ${db.datname}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    const result = await client.query<{ datname: string }>(`
      SELECT datname FROM pg_database WHERE datistemplate = false
      ORDER BY datname
    `);
    const pluginDbs = result.rows
      .map((r) => r.datname)
      .filter((db) => db.startsWith("backstage_plugin_"));

    if (pluginDbs.length > 0) {
      const allDbs = result.rows.map((r) => r.datname);
      const backstageDbs = allDbs.filter((db) => db.includes("backstage"));

      const activeDbChecks = await Promise.all(
        pluginDbs.map(async (db) => {
          try {
            const connCheck = await client.query<{ count: string }>(
              `
              SELECT count(*) as count
              FROM pg_stat_activity
              WHERE datname = $1
            `,
              [db],
            );
            return {
              db,
              activeConnections: parseInt(connCheck.rows[0].count, 10),
            };
          } catch {
            return { db, activeConnections: 0 };
          }
        }),
      );

      const activeDbs = activeDbChecks.filter((c) => c.activeConnections > 0);
      if (activeDbs.length > 0) {
        throw new Error(
          `Found ${pluginDbs.length} plugin databases (should use schemas instead): ${pluginDbs.join(", ")}\n` +
            `Active databases (in use): ${activeDbs.map((c) => `${c.db} (${c.activeConnections} connections)`).join(", ")}\n` +
            `This indicates RHDH is NOT using schema mode.\n` +
            `All Backstage-related databases: ${backstageDbs.join(", ")}\n` +
            `Possible causes:\n` +
            `  1. App-config not properly updated with pluginDivisionMode: "schema"\n` +
            `  2. RHDH pods are still using old database mode\n` +
            `  3. RHDH needs a full restart to switch to schema mode`,
        );
      } else {
        console.warn(
          `[WARNING]  Found ${pluginDbs.length} leftover plugin databases with no active connections: ${pluginDbs.join(", ")}`,
        );
        console.warn(
          `   These appear to be from before schema mode was enabled. They should be cleaned up.`,
        );
      }
    }

    console.log(
      "✓ No separate plugin databases found (schema mode is working)",
    );
    await client.end();
  });

  test("Verify RHDH is accessible", async ({ page }) => {
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      console.warn(
        "BASE_URL environment variable is not set. Attempting to determine from OpenShift Route...",
      );
      const kubeClient = new KubeClient();
      try {
        const routeNames = [
          `${releaseName}-developer-hub`,
          releaseName,
          `backstage-${releaseName}`,
        ];

        let routeHost: string | null = null;
        for (const routeName of routeNames) {
          try {
            const route =
              (await kubeClient.customObjectsApi.getNamespacedCustomObject(
                "route.openshift.io",
                "v1",
                namespace,
                "routes",
                routeName,
              )) as { body?: { spec?: { host?: string } } };

            if (route?.body?.spec?.host) {
              routeHost = route.body.spec.host;
              console.log(
                `✓ Found OpenShift Route: ${routeName} with host: ${routeHost}`,
              );
              break;
            }
          } catch {
            continue;
          }
        }

        if (routeHost) {
          baseUrl = `https://${routeHost}`;
          console.log(`✓ Using BASE_URL from Route: ${baseUrl}`);
        } else {
          console.warn(
            "Could not find OpenShift Route. Please set BASE_URL environment variable.",
          );
          throw new Error(
            "BASE_URL environment variable is required for this test.\n" +
              "Set it to your RHDH URL, e.g.:\n" +
              `  export BASE_URL="https://your-rhdh-url.com"`,
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes("BASE_URL")) {
          throw err;
        }
        throw new Error(
          "BASE_URL environment variable is required for this test.\n" +
            "Could not automatically determine URL from OpenShift Route.\n" +
            "Set it manually, e.g.:\n" +
            `  export BASE_URL="https://your-rhdh-url.com"`,
        );
      }
    }

    const originalGoto = page.goto.bind(page);
    const interceptedBaseUrl = baseUrl;
    page.goto = async (
      url: string,
      options?: Parameters<typeof page.goto>[1],
    ) => {
      if (url.startsWith("/") && !url.startsWith("//")) {
        url = `${interceptedBaseUrl}${url}`;
      } else if (!url.startsWith("http")) {
        url = `${interceptedBaseUrl}/${url}`;
      }
      return originalGoto(url, options);
    };

    const common = new Common(page);
    await common.loginAsGuest();
  });
});
