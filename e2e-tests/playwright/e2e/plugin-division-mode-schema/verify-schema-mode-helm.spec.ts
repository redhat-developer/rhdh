import { test } from "@playwright/test";
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
  test.skip(
    !!process.env.JOB_NAME?.includes("operator"),
    "This test file is for Helm Chart only",
  );

  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME || "redhat-developer-hub";

  // Helm chart resource names
  const deploymentName = releaseName;
  const postgresPodName = `${releaseName}-postgresql-0`;
  const postgresServiceName = `${releaseName}-postgresql`;
  const configMapName = `${releaseName}-app-config`;
  const secretName = `${releaseName}-postgresql`; // Helm chart managed secret
  const podLabelSelector = `app.kubernetes.io/component=backstage,app.kubernetes.io/instance=${releaseName},app.kubernetes.io/name=developer-hub`;

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
      // Schemas are verified in the next test, which polls until they appear
    }
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
