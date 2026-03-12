import { test } from "@playwright/test";
import * as yaml from "js-yaml";
import { Client } from "pg";
import * as k8s from "@kubernetes/client-node";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";
import { configurePostgresCredentials } from "../../utils/postgres-config";
import {
  getSchemaModeEnv,
  connectAdminClient,
  throwConnectionError,
  cleanupOldPluginDatabases,
  setupSchemaModeDatabase,
  quoteIdent,
} from "./schema-mode-db";

interface AppConfigDatabaseConnection {
  database?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
}

interface AppConfigDatabase {
  client?: string;
  pluginDivisionMode?: string;
  ensureSchemaExists?: boolean;
  ensureExists?: boolean;
  connection?: AppConfigDatabaseConnection;
}

interface AppConfigYaml {
  backend?: { database?: AppConfigDatabase };
  [key: string]: unknown;
}

test.describe("Verify pluginDivisionMode: schema (Operator)", () => {
  test.skip(
    !!process.env.JOB_NAME?.includes("helm"),
    "This test file is for Operator only",
  );

  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  // Operator deployment naming: backstage-${RELEASE_NAME}
  const releaseName = process.env.RELEASE_NAME || "developer-hub";
  // Always use Operator naming convention for this test file
  const deploymentName = `backstage-${releaseName}`;

  let dbHost: string;
  let dbAdminUser: string;
  let dbAdminPassword: string;
  let dbName: string;
  let dbUser: string;
  let dbPassword: string;

  test.beforeAll(async () => {
    test.setTimeout(300000);
    if (
      !process.env.SCHEMA_MODE_DB_HOST ||
      !process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD ||
      !process.env.SCHEMA_MODE_DB_PASSWORD
    ) {
      test.skip(
        true,
        "SCHEMA_MODE_* env vars not set; schema-mode tests are opt-in",
      );
      return;
    }
    const env = getSchemaModeEnv();
    dbHost = env.dbHost;
    dbAdminUser = env.dbAdminUser;
    dbAdminPassword = env.dbAdminPassword;
    dbName = env.dbName;
    dbUser = env.dbUser; // backstage_schema_user default from getSchemaModeEnv
    dbPassword = env.dbPassword;

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

    const kubeClient = new KubeClient();

    console.log(`Connecting to PostgreSQL at ${dbHost}:5432...`);
    const postgresPodName = `backstage-psql-${releaseName}-0`;
    let adminClient: Client;
    try {
      adminClient = await connectAdminClient({
        dbHost,
        dbAdminUser,
        dbAdminPassword,
      });
      console.log("✓ Connected to PostgreSQL");
    } catch (error) {
      throwConnectionError(dbHost, namespace, postgresPodName, error);
    }

    await cleanupOldPluginDatabases(adminClient!);
    await setupSchemaModeDatabase(adminClient!, {
      dbHost,
      dbAdminUser,
      dbAdminPassword,
      dbName,
      dbUser,
      dbPassword,
    });

    console.log("Configuring RHDH (Operator deployment) for schema mode...");

    let podDbHost = dbHost;
    let sslMode = "require";
    if (dbHost === "localhost" || dbHost === "127.0.0.1") {
      podDbHost = `backstage-psql-${releaseName}`;

      try {
        await kubeClient.coreV1Api.readNamespacedService(podDbHost, namespace);
        console.log(`✓ Verified PostgreSQL service exists: ${podDbHost}`);
      } catch {
        console.warn(
          `[WARNING]  Warning: Could not verify PostgreSQL service '${podDbHost}' exists`,
        );
        console.warn(
          `   Service might have a different name. Checking available services...`,
        );
        try {
          const services =
            await kubeClient.coreV1Api.listNamespacedService(namespace);
          const pgServices = services.body.items.filter(
            (s) =>
              s.metadata?.name?.includes("psql") ||
              s.metadata?.name?.includes("postgres"),
          );
          if (pgServices.length > 0) {
            console.warn(
              `   Found PostgreSQL-related services: ${pgServices.map((s) => s.metadata?.name).join(", ")}`,
            );
            console.warn(
              `   Using: ${podDbHost} (if this fails, check the actual service name)`,
            );
          }
        } catch {
          // Ignore list errors
        }
      }

      // For in-cluster connections, SSL is typically not required
      sslMode = "disable";
      console.log(
        `Using service name for pods: ${podDbHost} (original host was ${dbHost} for port-forward)`,
      );
      console.log(`Setting SSL mode to 'disable' for in-cluster connection`);
      console.log(
        `Note: Pods will connect to PostgreSQL service, not localhost`,
      );
    }

    // Operator uses postgres-cred secret (not Helm-managed secret)
    // Check if secret already exists and has correct values
    let secretNeedsUpdate = true;
    try {
      const existingSecret = await kubeClient.coreV1Api.readNamespacedSecret(
        "postgres-cred",
        namespace,
      );
      const existingHost = existingSecret.body.data?.POSTGRES_HOST
        ? Buffer.from(
            existingSecret.body.data.POSTGRES_HOST,
            "base64",
          ).toString()
        : null;
      const existingUser = existingSecret.body.data?.POSTGRES_USER
        ? Buffer.from(
            existingSecret.body.data.POSTGRES_USER,
            "base64",
          ).toString()
        : null;
      const existingDb = existingSecret.body.data?.POSTGRES_DB
        ? Buffer.from(existingSecret.body.data.POSTGRES_DB, "base64").toString()
        : null;

      // Check if secret already has the correct values
      if (
        existingHost === podDbHost &&
        existingUser === dbUser &&
        existingDb === dbName
      ) {
        console.log(
          "✓ Postgres credentials secret already configured correctly, skipping update",
        );
        secretNeedsUpdate = false;
      } else {
        console.log(
          `Secret needs update: host=${existingHost === podDbHost}, user=${existingUser === dbUser}, db=${existingDb === dbName}`,
        );
      }
    } catch {
      // Secret doesn't exist, we need to create it
      console.log("Postgres credentials secret not found, will create it");
    }

    if (secretNeedsUpdate) {
      await configurePostgresCredentials(kubeClient, namespace, {
        host: podDbHost,
        user: dbUser,
        password: dbPassword,
        database: dbName, // Set POSTGRES_DB in secret
        sslMode: sslMode,
      });
      console.log("✓ Postgres credentials secret updated");
    }

    // SOLUTION: Create a separate ConfigMap for database config that the operator won't manage
    // The operator manages the default app-config ConfigMap and can overwrite it.
    // By creating a separate ConfigMap, we avoid this issue.
    let needsRestart = false; // Declare early since we may set it when patching CR

    // CRITICAL: Patch Backstage CR (Operator only - Helm chart doesn't use CRs)
    // This injects postgres-cred secret as environment variables
    // Without this, RHDH won't read POSTGRES_DB from the secret
    const backstageCrName = releaseName;
    const backstageCrGroup = "rhdh.redhat.com";
    const backstageCrVersion = "v1alpha4"; // Match your CR API version
    const backstageCrPlural = "backstages";
    try {
      interface BackstageCrBody {
        spec?: {
          application?: {
            extraEnvs?: { secrets?: (string | { name?: string })[] };
          };
        };
      }
      const currentCr =
        (await kubeClient.customObjectsApi.getNamespacedCustomObject(
          backstageCrGroup,
          backstageCrVersion,
          namespace,
          backstageCrPlural,
          backstageCrName,
        )) as { body: BackstageCrBody };

      const spec = currentCr.body.spec || {};
      const application = spec.application || {};
      const extraEnvs = application.extraEnvs || {};
      const secrets = extraEnvs.secrets || [];

      const secretAlreadyReferenced = secrets.some(
        (s: string | { name?: string }) =>
          (typeof s === "string" && s === "postgres-cred") ||
          (typeof s === "object" && s.name === "postgres-cred"),
      );

      if (!secretAlreadyReferenced) {
        const patch = [];

        // Ensure paths exist
        if (!spec.application) {
          patch.push({ op: "add", path: "/spec/application", value: {} });
        }
        if (!application.extraEnvs) {
          patch.push({
            op: "add",
            path: "/spec/application/extraEnvs",
            value: {},
          });
        }
        if (!extraEnvs.secrets) {
          patch.push({
            op: "add",
            path: "/spec/application/extraEnvs/secrets",
            value: [],
          });
        }

        // Add postgres-cred secret
        patch.push({
          op: "add",
          path: "/spec/application/extraEnvs/secrets/-",
          value: { name: "postgres-cred" },
        });

        await kubeClient.customObjectsApi.patchNamespacedCustomObject(
          backstageCrGroup,
          backstageCrVersion,
          namespace,
          backstageCrPlural,
          backstageCrName,
          patch,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/json-patch+json" } },
        );
        console.log(
          "✓ Patched Backstage CR to inject postgres-cred secret as environment variables",
        );
        needsRestart = true;
      } else {
        console.log("✓ Backstage CR already references postgres-cred secret");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("not found") || errorMsg.includes("404")) {
        console.warn(
          `[WARNING]  Backstage CR '${backstageCrName}' not found - RHDH may not read POSTGRES_DB from secret`,
        );
        console.warn(
          `   You may need to manually add postgres-cred to spec.application.extraEnvs.secrets`,
        );
      } else {
        console.warn(
          `[WARNING]  Could not patch Backstage CR to add postgres-cred secret: ${errorMsg}`,
        );
        console.warn(
          `   RHDH may not read POSTGRES_DB from the secret without this configuration`,
        );
      }
    }
    const instanceName = releaseName; // Use release name as instance name
    const dbConfigMapName = `backstage-database-config-${instanceName}`;
    const dbConfigContent = {
      backend: {
        database: {
          client: "pg",
          pluginDivisionMode: "schema",
          ensureSchemaExists: true, // Required for schema mode - schemas won't be created without this
          connection: {
            host: `\${POSTGRES_HOST}`,
            port: `\${POSTGRES_PORT}`,
            user: `\${POSTGRES_USER}`,
            password: `\${POSTGRES_PASSWORD}`,
            database: `\${POSTGRES_DB}`,
          },
        },
      },
    };

    const dbConfigYaml = yaml.dump(dbConfigContent);

    // Create or update the separate database ConfigMap
    let dbConfigMapExists = false;
    try {
      await kubeClient.coreV1Api.readNamespacedConfigMap(
        dbConfigMapName,
        namespace,
      );
      dbConfigMapExists = true;
    } catch {
      // ConfigMap doesn't exist, will create it
    }

    const dbConfigMap: k8s.V1ConfigMap = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: dbConfigMapName,
        namespace: namespace,
        labels: {
          "app.kubernetes.io/instance": instanceName,
          "app.kubernetes.io/name": "backstage",
          "app.kubernetes.io/component": "backstage",
        },
      },
      data: {
        "database-config.yaml": dbConfigYaml,
      },
    };

    if (dbConfigMapExists) {
      await kubeClient.coreV1Api.replaceNamespacedConfigMap(
        dbConfigMapName,
        namespace,
        dbConfigMap,
      );
      console.log(`✓ Updated separate database ConfigMap: ${dbConfigMapName}`);
    } else {
      await kubeClient.coreV1Api.createNamespacedConfigMap(
        namespace,
        dbConfigMap,
      );
      console.log(`✓ Created separate database ConfigMap: ${dbConfigMapName}`);
      console.log(
        "   This ConfigMap won't be managed by the operator, so it won't be overwritten.",
      );
    }

    // Try to patch the Backstage CR to reference this ConfigMap
    // This ensures it gets mounted even if not in the CR spec initially
    // Add timeout to prevent hanging
    // Note: backstageCrName, backstageCrGroup, etc. are already defined above
    try {
      // Get current CR with timeout
      const crPromise = kubeClient.customObjectsApi.getNamespacedCustomObject(
        backstageCrGroup,
        backstageCrVersion,
        namespace,
        backstageCrPlural,
        backstageCrName,
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(new Error("CR get operation timed out after 30 seconds")),
          30000,
        ),
      );
      interface CrWithAppConfig {
        body: {
          spec?: {
            application?: { appConfig?: { configMaps?: { name?: string }[] } };
          };
        };
      }
      const currentCr = (await Promise.race([
        crPromise,
        timeoutPromise,
      ])) as CrWithAppConfig;

      // Check if appConfig.configMaps already includes our ConfigMap
      const spec = currentCr.body.spec || {};
      const application = spec.application || {};
      const appConfig = application.appConfig || {};
      const configMaps = appConfig.configMaps || [];

      const alreadyReferenced = configMaps.some(
        (cm: { name?: string }) => cm.name === dbConfigMapName,
      );

      if (!alreadyReferenced) {
        // Patch the CR to add our ConfigMap reference (JSON Patch ops with varying value shapes)
        type JsonPatchOp = { op: string; path: string; value?: unknown };
        const patch: JsonPatchOp[] = [
          {
            op: "add",
            path: "/spec/application/appConfig/configMaps/-",
            value: { name: dbConfigMapName },
          },
        ];

        // Ensure the paths exist
        if (!spec.application) {
          patch.unshift({
            op: "add",
            path: "/spec/application",
            value: {},
          });
        }
        if (!application.appConfig) {
          patch.unshift({
            op: "add",
            path: "/spec/application/appConfig",
            value: { configMaps: [] },
          });
        }
        if (!appConfig.configMaps) {
          patch.unshift({
            op: "add",
            path: "/spec/application/appConfig/configMaps",
            value: [],
          });
        }

        // Patch with timeout
        const patchPromise =
          kubeClient.customObjectsApi.patchNamespacedCustomObject(
            backstageCrGroup,
            backstageCrVersion,
            namespace,
            backstageCrPlural,
            backstageCrName,
            patch,
            undefined,
            undefined,
            undefined,
            { headers: { "Content-Type": "application/json-patch+json" } },
          );
        const patchTimeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error("CR patch operation timed out after 30 seconds"),
              ),
            30000,
          ),
        );
        await Promise.race([patchPromise, patchTimeoutPromise]);
        console.log(`✓ Patched Backstage CR to reference database ConfigMap`);
        needsRestart = true;
      } else {
        console.log(`✓ Backstage CR already references database ConfigMap`);
      }
    } catch (crError) {
      const errorMsg =
        crError instanceof Error ? crError.message : String(crError);
      if (errorMsg.includes("not found") || errorMsg.includes("404")) {
        console.log(
          `   Backstage CR '${backstageCrName}' not found - this is OK, the separate ConfigMap was created.`,
        );
        console.log(
          `   If the CR exists with a different name, you may need to manually add the ConfigMap reference.`,
        );
      } else if (errorMsg.includes("timeout")) {
        console.warn(`[WARNING]  CR operation timed out: ${errorMsg}`);
        console.warn(
          `   Continuing anyway - the separate ConfigMap was created.`,
        );
      } else {
        console.warn(`[WARNING]  Could not patch Backstage CR: ${errorMsg}`);
        console.warn(
          `   The separate ConfigMap was created, but may not be automatically mounted.`,
        );
        console.warn(
          `   You may need to manually add it to the Backstage CR's spec.application.appConfig.configMaps.`,
        );
      }
    }

    // Also update the main ConfigMap (as fallback, but operator may overwrite it)
    // Operator ConfigMap naming: backstage-appconfig-${RELEASE_NAME}
    const configMapName = process.env.RELEASE_NAME
      ? `backstage-appconfig-${process.env.RELEASE_NAME}`
      : "backstage-appconfig-developer-hub";
    const configMapResponse = await kubeClient.getConfigMap(
      configMapName,
      namespace,
    );
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

    // Check if already configured for schema mode with the correct database
    const currentDbConfig = appConfig.backend.database;
    const isAlreadyConfigured =
      currentDbConfig?.pluginDivisionMode === "schema" &&
      (currentDbConfig?.connection?.database === `\${POSTGRES_DB}` ||
        currentDbConfig?.connection?.database === dbName);

    if (!isAlreadyConfigured) {
      console.log(
        "Also updating main app-config for schema mode (as fallback)...",
      );
      console.log(
        "[WARNING]  NOTE: The operator may overwrite the main ConfigMap, but we've created a separate one.",
      );

      // Merge database config into existing backend config (don't overwrite other backend settings)
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

      // Verify the update if still present (operator may overwrite main ConfigMap)
      const verifyConfig = await kubeClient.getConfigMap(
        configMapName,
        namespace,
      );
      const verifyConfigKey = Object.keys(verifyConfig.body.data || {}).find(
        (key) => key.includes("app-config"),
      );
      if (!verifyConfigKey) {
        console.warn(
          `[WARNING]  Could not find app-config key in ConfigMap ${configMapName}. Available keys: ${Object.keys(verifyConfig.body.data || {}).join(", ")}`,
        );
      } else if (verifyConfig.body.data?.[verifyConfigKey]) {
        try {
          const verifyAppConfig = yaml.load(
            verifyConfig.body.data[verifyConfigKey],
          ) as AppConfigYaml;
          if (!verifyAppConfig?.backend?.database) {
            console.warn(
              "[WARNING]  Main app-config has no backend.database after update (operator may have overwritten it). Schema mode will use the separate database ConfigMap.",
            );
          } else {
            const verifyDbConfig = verifyAppConfig.backend.database;
            if (verifyDbConfig.pluginDivisionMode !== "schema") {
              console.warn(
                `[WARNING]  Main app-config pluginDivisionMode is "${verifyDbConfig.pluginDivisionMode}" instead of "schema". Relying on separate database ConfigMap.`,
              );
            } else {
              console.log("✓ Verified app-config update is correct");
              console.log(
                `  pluginDivisionMode: ${verifyDbConfig.pluginDivisionMode}`,
              );
              console.log(
                `  ensureSchemaExists: ${verifyDbConfig.ensureSchemaExists ?? "not set (defaults to false)"}`,
              );
              console.log(`  database: ${verifyDbConfig.connection?.database}`);
            }
          }
        } catch (parseError) {
          console.warn(
            `[WARNING]  Could not parse main app-config after update: ${parseError instanceof Error ? parseError.message : String(parseError)}. Continuing anyway.`,
          );
        }
      }
    } else {
      console.log("✓ RHDH is already configured for schema mode in app-config");
      console.log(
        "[WARNING]  However, RHDH needs to be restarted to actually use schema mode.",
      );
      console.log(
        "   If RHDH was already running, it may still be using separate databases.",
      );
      console.log("   Forcing restart to ensure schema mode is active...");
      needsRestart = true; // Force restart even if config is already set
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

      if (deploymentReady) {
        console.log(
          `✓ Deployment is already running (${readyReplicas} ready, ${availableReplicas} available)`,
        );
      } else {
        console.log(
          `[WARNING]  Deployment is not ready (${readyReplicas} ready, ${availableReplicas} available)`,
        );
      }
    } catch {
      console.log(
        "Could not check deployment status, will proceed with restart if needed",
      );
    }

    // Always restart if schema mode needs to be active (RHDH requires restart to pick up schema mode)
    if (needsRestart) {
      console.log("Restarting RHDH to apply schema mode configuration...");
      console.log("   Note: RHDH requires a restart to switch to schema mode.");
      await kubeClient.restartDeployment(deploymentName, namespace);
      console.log("✓ RHDH restart completed successfully");
      // restartDeployment already waited for deployment ready; schemas are verified in "Verify schemas were created" test
    } else if (!deploymentReady) {
      console.log(
        "[WARNING]  No config changes needed, but deployment is not ready.",
      );
      console.log("   Waiting for deployment to become ready...");
      await kubeClient.waitForDeploymentReady(
        deploymentName,
        namespace,
        1,
        120000,
      );
    } else {
      console.log(
        "✓ No restart needed - configuration already applied and deployment is ready",
      );
    }
  });

  test("Verify schemas were created", async () => {
    test.setTimeout(600000); // 10 minutes - schemas may take time to be created as plugins initialize
    const kubeClient = new KubeClient();
    await kubeClient.waitForDeploymentReady(
      deploymentName,
      namespace,
      1,
      180000,
    );

    // Use admin user to check for schemas - more reliable and can see all schemas
    // Polling loop below waits for schemas (up to 5 min); no fixed delay needed
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

      // Every 60 seconds, check pod logs and try to trigger plugin initialization
      if (elapsed > 0 && elapsed % 60 === 0) {
        try {
          const labelSelector =
            "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";
          const podsResponse = await kubeClient.coreV1Api.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            labelSelector,
          );
          if (podsResponse.body.items.length > 0) {
            const podName = podsResponse.body.items[0].metadata?.name;
            if (podName) {
              // Check environment variables to see what database RHDH is using
              try {
                const pod = await kubeClient.coreV1Api.readNamespacedPod(
                  podName,
                  namespace,
                );
                const backstageContainer = pod.body.spec?.containers?.find(
                  (c) => c.name === "backstage-backend",
                );
                if (backstageContainer) {
                  const postgresDbEnv = backstageContainer.env?.find(
                    (e) => e.name === "POSTGRES_DB",
                  );
                  if (postgresDbEnv) {
                    const dbValue =
                      postgresDbEnv.value ||
                      (postgresDbEnv.valueFrom?.secretKeyRef
                        ? "<from secret>"
                        : "NOT SET");
                    console.log(`  Pod POSTGRES_DB env var: ${dbValue}`);
                    if (postgresDbEnv.valueFrom?.secretKeyRef) {
                      console.log(
                        `    Secret: ${postgresDbEnv.valueFrom.secretKeyRef.name}, Key: ${postgresDbEnv.valueFrom.secretKeyRef.key}`,
                      );
                    }
                  } else {
                    console.warn(
                      `  [WARNING]  POSTGRES_DB environment variable not found in pod!`,
                    );
                  }
                }
              } catch {
                // Ignore
              }

              const logs = await kubeClient.coreV1Api.readNamespacedPodLog(
                podName,
                namespace,
                "backstage-backend",
                false,
                undefined,
                undefined,
                undefined,
                undefined,
                50, // Get more lines
                undefined,
              );
              if (logs.body) {
                const logLines = logs.body.split("\n");
                // Look for database connection and schema creation messages
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
                } else {
                  const recentLogs = logLines.slice(-5);
                  console.log(`  Recent pod logs (last 5 lines):`);
                  recentLogs.forEach((line) => {
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

      // Try to get pod logs for diagnostics
      let podLogsHint = "";
      let podLogs = "";
      try {
        // Operator pod label selector
        const labelSelector =
          "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";
        const podsResponse = await kubeClient.coreV1Api.listNamespacedPod(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          labelSelector,
        );
        if (podsResponse.body.items.length > 0) {
          const podName = podsResponse.body.items[0].metadata?.name;
          if (podName) {
            podLogsHint = `\n  5. Check pod logs: oc logs ${podName} -n ${namespace} | grep -i "schema\\|database\\|postgres"`;

            try {
              const logs = await kubeClient.coreV1Api.readNamespacedPodLog(
                podName,
                namespace,
                "backstage-backend",
                false,
                undefined,
                undefined,
                undefined,
                undefined,
                100,
                undefined,
              );
              if (logs.body) {
                const logLines = logs.body
                  .split("\n")
                  .filter(
                    (l) =>
                      l.toLowerCase().includes("schema") ||
                      l.toLowerCase().includes("database") ||
                      l.toLowerCase().includes("postgres") ||
                      l.toLowerCase().includes("plugin") ||
                      l.toLowerCase().includes("error") ||
                      l.toLowerCase().includes("fail"),
                  );
                if (logLines.length > 0) {
                  podLogs = `\n\nRecent relevant pod logs:\n${logLines.slice(-20).join("\n")}`;
                }
              }
            } catch {
              // Ignore log retrieval errors
            }
          }
        }
      } catch {
        // Ignore errors getting pod info
      }

      let configCheck = "";
      let secretCheck = "";
      try {
        // Operator ConfigMap naming
        const configMapName = process.env.RELEASE_NAME
          ? `backstage-appconfig-${process.env.RELEASE_NAME}`
          : "backstage-appconfig-developer-hub";
        const verifyConfig = await kubeClient.getConfigMap(
          configMapName,
          namespace,
        );
        const verifyConfigKey = Object.keys(verifyConfig.body.data || {}).find(
          (key) => key.includes("app-config"),
        );

        if (!verifyConfigKey) {
          configCheck = `\n\n[WARNING]  Could not find app-config key in ConfigMap ${configMapName}`;
          configCheck += `\n  Available keys: ${Object.keys(verifyConfig.body.data || {}).join(", ")}`;
        } else if (verifyConfig.body.data) {
          try {
            const configContent = verifyConfig.body.data[verifyConfigKey];
            // Log first 500 chars of config for debugging
            const configPreview = configContent.substring(
              0,
              Math.min(500, configContent.length),
            );
            const verifyAppConfig = yaml.load(configContent) as AppConfigYaml;
            if (!verifyAppConfig) {
              configCheck = `\n\n[WARNING]  Failed to parse app-config YAML`;
              configCheck += `\n  Config preview (first 500 chars):\n${configPreview}...`;
            } else if (!verifyAppConfig.backend) {
              configCheck = `\n\n[WARNING]  App-config has no 'backend' section`;
              configCheck += `\n  Top-level keys: ${Object.keys(verifyAppConfig).join(", ")}`;
              configCheck += `\n  Config preview (first 500 chars):\n${configPreview}...`;
            } else {
              const verifyDbConfig = verifyAppConfig.backend.database;
              if (!verifyDbConfig) {
                configCheck = `\n\n[WARNING]  App-config backend has no 'database' section`;
                configCheck += `\n  Backend keys: ${Object.keys(verifyAppConfig.backend).join(", ")}`;
                configCheck += `\n  Config preview (first 500 chars):\n${configPreview}...`;
              } else {
                configCheck =
                  `\n\nCurrent app-config database settings:\n` +
                  `  pluginDivisionMode: ${verifyDbConfig?.pluginDivisionMode || "NOT SET"}\n` +
                  `  database: ${verifyDbConfig?.connection?.database || "NOT SET"}\n` +
                  `  host: ${verifyDbConfig?.connection?.host || "NOT SET"}\n` +
                  `  user: ${verifyDbConfig?.connection?.user || "NOT SET"}\n` +
                  `  port: ${verifyDbConfig?.connection?.port || "NOT SET"}`;
              }
            }
          } catch (parseError) {
            configCheck = `\n\n[WARNING]  Error parsing app-config YAML: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            if (verifyConfig.body.data[verifyConfigKey]) {
              const configPreview = verifyConfig.body.data[
                verifyConfigKey
              ].substring(
                0,
                Math.min(500, verifyConfig.body.data[verifyConfigKey].length),
              );
              configCheck += `\n  Config preview (first 500 chars):\n${configPreview}...`;
            }
          }
        }

        // Check secret
        try {
          const secret = await kubeClient.coreV1Api.readNamespacedSecret(
            "postgres-cred",
            namespace,
          );
          const secretData = secret.body.data || {};
          const secretHost = secretData.POSTGRES_HOST
            ? Buffer.from(secretData.POSTGRES_HOST, "base64").toString()
            : "NOT SET";
          const secretUser = secretData.POSTGRES_USER
            ? Buffer.from(secretData.POSTGRES_USER, "base64").toString()
            : "NOT SET";
          const secretPort = secretData.POSTGRES_PORT
            ? Buffer.from(secretData.POSTGRES_PORT, "base64").toString()
            : "NOT SET";
          const secretDb = secretData.POSTGRES_DB
            ? Buffer.from(secretData.POSTGRES_DB, "base64").toString()
            : "NOT SET";
          const secretPassword = secretData.POSTGRES_PASSWORD
            ? "***SET***"
            : "NOT SET";
          secretCheck =
            `\n\nCurrent postgres-cred secret values:\n` +
            `  POSTGRES_HOST: ${secretHost}\n` +
            `  POSTGRES_USER: ${secretUser}\n` +
            `  POSTGRES_PORT: ${secretPort}\n` +
            `  POSTGRES_DB: ${secretDb}\n` +
            `  POSTGRES_PASSWORD: ${secretPassword}`;
        } catch (secretError) {
          secretCheck = `\n\n[WARNING]  Could not read postgres-cred secret: ${secretError instanceof Error ? secretError.message : String(secretError)}`;
        }
      } catch (error) {
        configCheck = `\n\n[WARNING]  Error reading ConfigMap: ${error instanceof Error ? error.message : String(error)}`;
      }

      const schemaOwnerInfo =
        allSchemaOwners.rows.length > 0
          ? `\n\nSchema owners:\n${allSchemaOwners.rows.map((r) => `  ${r.schema_name}: ${r.schema_owner}`).join("\n")}`
          : "";

      throw new Error(
        `Expected at least 3 plugin schemas (catalog, scaffolder, auth, permission, search), found: ${allSchemaNames.join(", ") || "none"}\n` +
          `Found ${found.length} expected schemas: ${found.join(", ") || "none"}\n` +
          `This suggests RHDH may not be using schema mode. Check:\n` +
          `  1. App-config has pluginDivisionMode: "schema" and database: "${dbName}"${configCheck}${secretCheck}\n` +
          `  2. RHDH pods can connect to PostgreSQL (verify postgres-cred secret matches expected values)\n` +
          `  3. RHDH has finished initializing (wait longer or check pod status)\n` +
          `  4. Database user has CREATE privilege on database ${dbName}\n` +
          `  5. RHDH version supports schema mode (check Backstage version)${schemaOwnerInfo}${podLogsHint}${podLogs}`,
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
      "Waiting for database connections to drain before checking for leftover plugin DBs...",
    );
    await new Promise((resolve) => setTimeout(resolve, 10000)); // brief drain; test then checks pg_database

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
          await client.query(
            `DROP DATABASE IF EXISTS ` + quoteIdent(db.datname),
          );
          console.log(`  Dropped leftover database: ${db.datname}`);
        } catch (err) {
          console.warn(
            `  Could not drop database ${db.datname}: ${err instanceof Error ? err.message : String(err)}`,
          );
          const activeConnections = await client.query<{ count: string }>(
            `
            SELECT count(*) as count
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
          `,
            [db.datname],
          );
          const connCount = parseInt(activeConnections.rows[0].count, 10);
          if (connCount > 0) {
            console.warn(
              `  Database ${db.datname} has ${connCount} active connection(s) - may still be in use by RHDH`,
            );
          }
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
        const releaseName = process.env.RELEASE_NAME || "developer-hub";
        const routeNames = [
          `backstage-${releaseName}`,
          `${releaseName}-developer-hub`,
          releaseName,
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
