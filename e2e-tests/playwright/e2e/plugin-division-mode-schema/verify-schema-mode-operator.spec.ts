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
  normalizeDbHost,
  connectWithSslFallback,
} from "./schema-mode-db";
import { ensureSchemaModePortForward } from "./schema-mode-port-forward";

interface AppConfigDatabaseConnection {
  database?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  ssl?: {
    rejectUnauthorized?: boolean;
    ca?: string;
    key?: string;
    cert?: string;
  };
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
  let stopSchemaModePortForward: (() => void) | undefined;
  let postgresPodName: string;

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(300000);
    const hasPfMeta =
      !!process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE &&
      !!process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE;
    const hasDirectHost = !!process.env.SCHEMA_MODE_DB_HOST;
    if (
      !process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD ||
      !process.env.SCHEMA_MODE_DB_PASSWORD ||
      (!hasPfMeta && !hasDirectHost)
    ) {
      testInfo.skip(
        true,
        "SCHEMA_MODE_* not set (need admin + app passwords and either port-forward metadata or SCHEMA_MODE_DB_HOST); schema-mode tests are opt-in",
      );
      return;
    }
    try {
      const pf = await ensureSchemaModePortForward();
      stopSchemaModePortForward = pf.stop;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      testInfo.skip(true, `Schema-mode port-forward: ${msg}`);
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
    postgresPodName = `backstage-psql-${releaseName}-0`;
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
            // SSL configuration for external Crunchy cluster (uses self-signed certs)
            ssl: {
              rejectUnauthorized: false,
            },
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

    // Check if already configured for schema mode with SSL
    const currentDbConfig = appConfig.backend.database;
    const isAlreadyConfigured =
      currentDbConfig?.pluginDivisionMode === "schema" &&
      (currentDbConfig?.connection?.database === `\${POSTGRES_DB}` ||
        currentDbConfig?.connection?.database === dbName) &&
      currentDbConfig?.connection?.ssl !== undefined; // Ensure SSL is configured for external cluster

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
          // SSL configuration for external Crunchy cluster (uses self-signed certs)
          ssl: {
            rejectUnauthorized: false,
          },
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

  test.afterAll(() => {
    stopSchemaModePortForward?.();
  });

  test("Verify RHDH is accessible", async ({ page }, testInfo) => {
    // If deployment never became ready (e.g. after PVC/scheduling issue during restart), skip instead of failing with "browser closed"
    const kubeClientForCheck = new KubeClient();
    try {
      const deployment =
        await kubeClientForCheck.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );
      const readyReplicas = deployment.body.status?.readyReplicas ?? 0;
      if (readyReplicas < 1) {
        testInfo.skip(
          true,
          "Deployment is not ready (e.g. cluster PVC/scheduling issue); skipping RHDH accessibility check.",
        );
        return;
      }
    } catch {
      // If we can't read deployment, continue and let the test try (may fail with a different error)
    }

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

  test("Verify plugin schemas were created and no plugin databases exist", async () => {
    console.log("Validating schema-mode database structure...");

    // Trigger schema creation by accessing RHDH catalog API
    // Schemas are created lazily when plugins first access the database
    console.log("Triggering schema creation by accessing catalog API...");
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      const kubeClient = new KubeClient();
      const routeNames = [`backstage-${releaseName}`, releaseName];
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
            baseUrl = `https://${route.body.spec.host}`;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (baseUrl) {
      try {
        // Access catalog API to trigger schema creation
        const catalogUrl = `${baseUrl}/api/catalog/entities`;
        const response = await fetch(catalogUrl, {
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          console.log("✓ Successfully triggered catalog access");
        } else {
          console.warn(
            `[WARNING] Catalog API returned ${response.status}, schemas may not be created yet`,
          );
        }
      } catch (error) {
        console.warn(
          `[WARNING] Could not access catalog API: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.warn("   Proceeding with schema validation anyway...");
      }
    }

    // Connect to the postgres database to check for plugin databases
    let adminClient: Client;
    try {
      adminClient = await connectAdminClient({
        dbHost,
        dbAdminUser,
        dbAdminPassword,
      });
      console.log("✓ Connected to PostgreSQL for validation");
    } catch (error) {
      throwConnectionError(dbHost, namespace, postgresPodName, error);
    }

    try {
      // 1. Verify that plugin schemas were created in the single database
      // Poll for schemas with timeout since they're created lazily
      console.log(
        `Polling for plugin schemas in database: ${dbName} (timeout: 60s)...`,
      );

      const targetDbConfig = {
        host: normalizeDbHost(dbHost),
        port: 5432,
        user: dbAdminUser,
        password: dbAdminPassword,
        database: dbName,
        connectionTimeoutMillis: 30000,
      };

      let pluginSchemas: string[] = [];
      const maxAttempts = 12; // 12 attempts * 5s = 60s total
      const pollIntervalMs = 5000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const targetDbClient = await connectWithSslFallback(targetDbConfig);

        const schemasResult = await targetDbClient.query<{
          schema_name: string;
        }>(
          `
          SELECT schema_name
          FROM information_schema.schemata
          WHERE schema_name LIKE 'backstage_plugin_%'
          ORDER BY schema_name
        `,
        );
        await targetDbClient.end();

        pluginSchemas = schemasResult.rows.map((r) => r.schema_name);

        if (pluginSchemas.length > 0) {
          console.log(
            `✓ Found ${pluginSchemas.length} plugin schemas after ${attempt} attempt(s): ${pluginSchemas.join(", ")}`,
          );
          break;
        }

        if (attempt < maxAttempts) {
          console.log(
            `   No schemas found yet (attempt ${attempt}/${maxAttempts}), waiting ${pollIntervalMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }

      // Assert that at least some core plugin schemas exist
      if (pluginSchemas.length === 0) {
        // Provide diagnostic information
        console.error(
          "Diagnostic: Checking RHDH pod logs for schema creation issues...",
        );
        try {
          const kubeClient = new KubeClient();
          const podLabelSelector = `rhdh.redhat.com/backstage=${releaseName}`;
          const pods = await kubeClient.coreV1Api.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            podLabelSelector,
          );
          if (pods.body.items.length > 0) {
            const podName = pods.body.items[0].metadata?.name;
            if (podName) {
              const logs = await kubeClient.coreV1Api.readNamespacedPodLog(
                podName,
                namespace,
                "backstage-backend",
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                1000, // Last 1000 lines
              );
              const relevantLogs = logs.body
                .split("\n")
                .filter(
                  (line) =>
                    line.includes("database") ||
                    line.includes("schema") ||
                    line.includes("plugin") ||
                    line.includes("error"),
                );
              if (relevantLogs.length > 0) {
                console.error(
                  "Relevant pod logs:\n" + relevantLogs.slice(-20).join("\n"),
                );
              }
            }
          }
        } catch {
          // Ignore diagnostic errors
        }

        throw new Error(
          `Schema mode validation failed: No plugin schemas (backstage_plugin_*) found in database ${dbName} after 60s.\n` +
            `Expected to find plugin schemas like backstage_plugin_catalog, backstage_plugin_scaffolder, etc.\n` +
            `This indicates that pluginDivisionMode: schema is not working correctly.\n` +
            `Possible causes:\n` +
            `  - RHDH pods are not reading the pluginDivisionMode: schema configuration\n` +
            `  - Database connection from RHDH pods is failing\n` +
            `  - Plugins are not being initialized\n` +
            `Check the RHDH pod logs above for more details.`,
        );
      }

      console.log(
        `✓ Verified ${pluginSchemas.length} plugin schemas exist in database ${dbName}`,
      );

      // 2. Verify that NO separate plugin databases were created
      console.log("Checking that no plugin databases exist...");
      const pluginDbsResult = await adminClient.query<{ datname: string }>(
        `
        SELECT datname
        FROM pg_database
        WHERE datistemplate = false
          AND datname LIKE 'backstage_plugin_%'
        ORDER BY datname
      `,
      );

      const pluginDatabases = pluginDbsResult.rows.map((r) => r.datname);

      if (pluginDatabases.length > 0) {
        throw new Error(
          `Schema mode validation failed: Found ${pluginDatabases.length} plugin databases: ${pluginDatabases.join(", ")}\n` +
            `In schema mode, plugins should create schemas within a single database, not separate databases.\n` +
            `This indicates that pluginDivisionMode: schema is not working correctly.`,
        );
      }

      console.log("✓ Verified no plugin databases exist (as expected)");
      console.log(
        "✓ Schema mode validation passed: plugins are using schemas, not databases",
      );
    } finally {
      await adminClient.end();
    }
  });
});
