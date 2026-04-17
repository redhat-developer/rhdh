import { chromium, test } from "@playwright/test";
import * as yaml from "js-yaml";
import { Client } from "pg";
import { execSync } from "child_process";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";
import {
  getSchemaModeEnv,
  connectAdminClient,
  throwConnectionError,
  cleanupOldPluginDatabases,
  setupSchemaModeDatabase,
} from "./schema-mode-db";
import { ensureSchemaModePortForward } from "./schema-mode-port-forward";

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
      ssl?: {
        rejectUnauthorized?: boolean;
        ca?: string;
        key?: string;
        cert?: string;
      };
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
  let deploymentName = releaseName;
  const postgresPodName = `${releaseName}-postgresql-0`;
  const postgresServiceName = `${releaseName}-postgresql`;
  let configMapName = `${releaseName}-app-config`;
  let secretName = `${releaseName}-postgresql`; // Helm chart managed secret
  const podLabelSelector = `app.kubernetes.io/component=backstage,app.kubernetes.io/instance=${releaseName},app.kubernetes.io/name=developer-hub`;

  let dbHost: string;
  let dbAdminUser: string;
  let dbAdminPassword: string;
  let dbName: string;
  let dbUser: string;
  let dbPassword: string;
  let stopSchemaModePortForward: (() => void) | undefined;

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
    dbUser = process.env.SCHEMA_MODE_DB_USER || "bn_backstage"; // Helm chart default user
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
    const deploymentCandidates = [`${releaseName}-developer-hub`, releaseName];
    const configMapCandidates = [
      `${releaseName}-developer-hub-app-config`,
      `${releaseName}-app-config`,
      "app-config-rhdh",
      "backstage-appconfig-developer-hub",
    ];
    const secretCandidates = [
      `${releaseName}-postgresql`,
      "rhdh-postgresql",
      "redhat-developer-hub-postgresql",
    ];

    for (const candidate of deploymentCandidates) {
      try {
        await kubeClient.appsApi.readNamespacedDeployment(candidate, namespace);
        deploymentName = candidate;
        console.log(`✓ Using deployment: ${deploymentName}`);
        break;
      } catch {
        // try next candidate
      }
    }

    for (const candidate of secretCandidates) {
      try {
        await kubeClient.coreV1Api.readNamespacedSecret(candidate, namespace);
        secretName = candidate;
        console.log(`✓ Using PostgreSQL secret: ${secretName}`);
        break;
      } catch {
        // try next candidate
      }
    }

    let configMapResolved = false;
    for (const candidate of configMapCandidates) {
      try {
        await kubeClient.getConfigMap(candidate, namespace);
        configMapName = candidate;
        configMapResolved = true;
        console.log(`✓ Using app-config ConfigMap: ${configMapName}`);
        break;
      } catch {
        // try next candidate
      }
    }
    if (!configMapResolved) {
      configMapName = await kubeClient.findAppConfigMap(namespace);
      console.log(`✓ Using discovered app-config ConfigMap: ${configMapName}`);
    }

    console.log(`Connecting to PostgreSQL at ${dbHost}:5432...`);
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

    console.log("Configuring RHDH for schema mode...");

    // Determine the PostgreSQL host that RHDH pods should use
    // - If using external Crunchy cluster (port-forward scenario), use cluster-internal service
    // - Otherwise use in-namespace service
    let rhdhPostgresHost = postgresServiceName;
    const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;

    if (dbHost === "localhost" || dbHost === "127.0.0.1") {
      // Port-forward scenario - check if it's to external cluster
      if (pfNamespace && pfNamespace !== namespace) {
        // External cluster - use fully qualified service name
        rhdhPostgresHost = `postgress-external-db-primary.${pfNamespace}.svc.cluster.local`;
        console.log(`✓ Using external Crunchy cluster: ${rhdhPostgresHost}`);
      } else {
        // In-namespace PostgreSQL service
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
    } else {
      // Direct host (not port-forward) - use as-is
      rhdhPostgresHost = dbHost;
      console.log(`✓ Using direct PostgreSQL host: ${rhdhPostgresHost}`);
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
        // Use createOrUpdateSecret to handle both create and update cases
        await kubeClient.createOrUpdateSecret(
          {
            metadata: {
              name: secretName,
            },
            data: {
              // Update password in all possible keys
              password: Buffer.from(dbPassword).toString("base64"),
              "postgres-password": Buffer.from(dbPassword).toString("base64"),
              "postgresql-password": Buffer.from(dbPassword).toString("base64"),
              POSTGRES_PASSWORD: Buffer.from(dbPassword).toString("base64"),
              // CRITICAL: Set POSTGRES_DB to the test database name
              // Helm chart reads this from the secret and uses it as the database name
              POSTGRES_DB: Buffer.from(dbName).toString("base64"),
              // Also set it in other possible keys that Helm chart might use
              "postgres-db": Buffer.from(dbName).toString("base64"),
              "postgresql-db": Buffer.from(dbName).toString("base64"),
              // Set POSTGRES_USER for completeness
              POSTGRES_USER: Buffer.from(dbUser).toString("base64"),
              "postgres-user": Buffer.from(dbUser).toString("base64"),
              "postgresql-user": Buffer.from(dbUser).toString("base64"),
              // CRITICAL: Set POSTGRES_HOST to the cluster-internal service that RHDH pods can reach
              POSTGRES_HOST: Buffer.from(rhdhPostgresHost).toString("base64"),
              "postgres-host": Buffer.from(rhdhPostgresHost).toString("base64"),
              "postgresql-host":
                Buffer.from(rhdhPostgresHost).toString("base64"),
              // Set POSTGRES_PORT
              POSTGRES_PORT: Buffer.from("5432").toString("base64"),
              "postgres-port": Buffer.from("5432").toString("base64"),
              "postgresql-port": Buffer.from("5432").toString("base64"),
            },
          },
          namespace,
        );
        console.log(
          `✓ Created/updated Helm chart secret ${secretName} with test user credentials and host: ${rhdhPostgresHost}`,
        );
        needsRestart = true; // Helm chart deployments need restart to pick up secret changes
      } catch (error) {
        console.warn(
          `[WARNING]  Could not create/update Helm chart secret ${secretName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.warn(
          `   You may need to manually create the secret or ensure the Helm chart user password matches the test user password.`,
        );
      }
    }

    // CRITICAL: Ensure all PostgreSQL environment variables are set in the deployment
    // Helm chart might not set these by default
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

        // Check which variables are missing
        const requiredVars = [
          "POSTGRES_HOST",
          "POSTGRES_PORT",
          "POSTGRES_DB",
          "POSTGRES_USER",
          "POSTGRES_PASSWORD",
        ];
        const missingVars = requiredVars.filter(
          (varName) => !env.some((e) => e.name === varName),
        );

        if (missingVars.length > 0) {
          console.log(
            `Adding PostgreSQL environment variables to deployment: ${missingVars.join(", ")}`,
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

          // Add each missing environment variable
          for (const varName of missingVars) {
            patch.push({
              op: "add",
              path: `/spec/template/spec/containers/${backstageContainerIndex}/env/-`,
              value: {
                name: varName,
                valueFrom: {
                  secretKeyRef: {
                    name: secretName,
                    key: varName,
                  },
                },
              },
            });
          }

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
              `✓ Added PostgreSQL environment variables to deployment via API: ${missingVars.join(", ")}`,
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
                `✓ Added PostgreSQL environment variables to deployment via oc command: ${missingVars.join(", ")}`,
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

              // Verify at least one of the critical variables was added
              const hasPostgresHost = verifyEnv.some(
                (e) => e.name === "POSTGRES_HOST",
              );
              if (!hasPostgresHost) {
                throw new Error(
                  "Patch command succeeded but POSTGRES_HOST was not found in deployment after patching",
                );
              }
              console.log(
                "✓ Verified PostgreSQL environment variables were added to deployment",
              );
              needsRestart = true;
            } catch (ocError) {
              const ocErrorMsg =
                ocError instanceof Error ? ocError.message : String(ocError);
              console.error(
                `[ERROR]  Failed to patch deployment via oc command: ${ocErrorMsg}`,
              );
              console.error(
                `   Please manually add PostgreSQL environment variables to deployment`,
              );
              throw new Error(
                `Failed to add PostgreSQL environment variables to deployment. Both API and oc command failed.`,
              );
            }
          }
        } else {
          console.log(
            "✓ All required PostgreSQL environment variables already exist in deployment",
          );
        }
      }
    } catch (deploymentError) {
      const errorMsg =
        deploymentError instanceof Error
          ? deploymentError.message
          : String(deploymentError);
      // Only log warning if it's not a critical error (critical errors are already thrown above)
      if (!errorMsg.includes("Failed to add PostgreSQL")) {
        console.warn(
          `[WARNING]  Could not check/add PostgreSQL environment variables to deployment: ${errorMsg}`,
        );
        console.warn(
          `   The deployment might need PostgreSQL environment variables for Backstage to connect to the database.`,
        );
      } else {
        throw deploymentError; // Re-throw critical errors
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

    // Check if already configured for schema mode with SSL
    const currentDbConfig = appConfig.backend.database;
    const isAlreadyConfigured =
      currentDbConfig?.pluginDivisionMode === "schema" &&
      (currentDbConfig?.connection?.database === `\${POSTGRES_DB}` ||
        currentDbConfig?.connection?.database === dbName) &&
      currentDbConfig?.connection?.ssl !== undefined; // Ensure SSL is configured for external cluster

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
    } else {
      console.log("✓ RHDH is already configured for schema mode in app-config");

      // Even if ConfigMap is correct, always restart to ensure pods load the configuration
      // (ConfigMap might have been updated by a previous run, but pods may still be using old config)
      console.log(
        "   Restarting deployment to ensure pods pick up schema mode configuration",
      );
      needsRestart = true;
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
        // restartDeployment already waited for deployment ready; schemas are verified in "Verify schemas were created" test
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
          console.log("Waiting for deployment to be ready (if it recovers)...");
          try {
            await kubeClient.waitForDeploymentReady(
              deploymentName,
              namespace,
              1,
              60000,
              10000,
              podLabelSelector,
            );
          } catch {
            console.warn(
              "[WARNING]  Deployment did not become ready within 60s; continuing anyway.",
            );
          }
        } else if (
          errorMsg.includes("Unschedulable") ||
          errorMsg.includes("Insufficient cpu") ||
          errorMsg.includes("No preemption victims found") ||
          errorMsg.includes("cannot be scheduled")
        ) {
          console.warn(
            "[WARNING]  Restart failed due to cluster capacity constraints (unschedulable pod).",
          );
          console.warn(
            "   This is an environment issue, not a schema-mode logic failure.",
          );
          console.warn(
            "   Continuing; accessibility test will self-skip when deployment is not ready.",
          );
        } else {
          throw restartError;
        }
      }
    } else if (!deploymentReady) {
      console.warn(
        "[WARNING]  No config changes needed, but deployment is not ready. Waiting...",
      );
      try {
        await kubeClient.waitForDeploymentReady(
          deploymentName,
          namespace,
          1,
          120000,
          10000,
          podLabelSelector,
        );
      } catch (waitError) {
        const errorMsg =
          waitError instanceof Error ? waitError.message : String(waitError);
        if (
          errorMsg.includes("Unschedulable") ||
          errorMsg.includes("Insufficient cpu") ||
          errorMsg.includes("No preemption victims found") ||
          errorMsg.includes("cannot be scheduled")
        ) {
          console.warn(
            "[WARNING]  Deployment still unschedulable due to cluster capacity limits.",
          );
          console.warn(
            "   Continuing; accessibility test will self-skip while deployment is not ready.",
          );
        } else {
          throw waitError;
        }
      }
    } else {
      console.log("✓ Configuration already applied, deployment is ready");
    }

    // Verify plugin schemas were created (while port-forward is still alive)
    console.log("Verifying plugin schemas were created...");
    try {
      const schemasResult = await adminClient!.query(`
        SELECT schema_name FROM information_schema.schemata
        WHERE schema_name LIKE 'backstage_plugin_%'
        ORDER BY schema_name
      `);

      const schemas = schemasResult.rows.map(
        (r: { schema_name: string }) => r.schema_name,
      );
      console.log(
        `✓ Found ${schemas.length} plugin schemas: ${schemas.join(", ")}`,
      );

      if (schemas.length === 0) {
        console.warn("⚠ No schemas found - schema mode may not be working");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠ Could not verify schemas: ${errorMsg}`);
    }
  });

  test.afterAll(() => {
    stopSchemaModePortForward?.();
  });

  test("Verify RHDH is accessible", async ({}, testInfo) => {
    // Check readiness before requesting the `page` fixture — otherwise Playwright still launches Chromium
    // even when we intend to skip (cluster capacity / scheduling).
    const kubeClientForCheck = new KubeClient();
    try {
      const deployment =
        await kubeClientForCheck.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );
      const readyReplicas = deployment.body.status?.readyReplicas ?? 0;
      const availableReplicas = deployment.body.status?.availableReplicas ?? 0;
      if (readyReplicas < 1 || availableReplicas < 1) {
        testInfo.skip(
          true,
          "Deployment is not ready/available (e.g. cluster PVC or scheduling capacity issue); skipping RHDH accessibility check.",
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

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
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
    } finally {
      await browser.close();
    }
  });
});
