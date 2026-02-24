import { test } from "@playwright/test";
import * as yaml from "js-yaml";
import * as k8s from "@kubernetes/client-node";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";
import { configurePostgresCredentials } from "../../utils/postgres-config";
import {
  setupSchemaModeDatabase,
  verifySchemasExist,
  verifyNoPluginDatabases,
} from "../../utils/schema-mode-config";

test.describe("Verify pluginDivisionMode: schema", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const job: string = process.env.JOB_NAME || "";
  let deploymentName = process.env.RELEASE_NAME + "-developer-hub";
  if (job.includes("operator")) {
    deploymentName = "backstage-" + process.env.RELEASE_NAME;
  }

  // Database configuration from environment
  const dbHost = process.env.SCHEMA_MODE_DB_HOST;
  const dbAdminUser = process.env.SCHEMA_MODE_DB_ADMIN_USER || "postgres";
  const dbAdminPassword = process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD;
  const dbName = process.env.SCHEMA_MODE_DB_NAME || "backstage_schema_test";
  const dbUser = process.env.SCHEMA_MODE_DB_USER || "backstage_schema_user";
  const dbPassword = process.env.SCHEMA_MODE_DB_PASSWORD;

  test.beforeAll(async () => {
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

    // Validate required environment variables
    if (!dbHost || !dbAdminPassword) {
      throw new Error(
        "SCHEMA_MODE_DB_HOST and SCHEMA_MODE_DB_ADMIN_PASSWORD environment variables must be set",
      );
    }

    if (!dbPassword) {
      throw new Error(
        "SCHEMA_MODE_DB_PASSWORD environment variable must be set",
      );
    }

    const kubeClient = new KubeClient();

    // Set up database with limited permissions user
    console.log("Setting up database for schema mode testing...");
    await setupSchemaModeDatabase({
      host: dbHost,
      adminUser: dbAdminUser,
      adminPassword: dbAdminPassword,
      databaseName: dbName,
      userName: dbUser,
      userPassword: dbPassword,
    });

    // Configure RHDH to use schema mode
    console.log("Configuring RHDH for schema mode...");
    await configurePostgresCredentials(kubeClient, namespace, {
      host: dbHost,
      user: dbUser,
      password: dbPassword,
    });

    // Update app-config to enable schema mode
    await updateAppConfigForSchemaMode(kubeClient, namespace, {
      host: dbHost,
      database: dbName,
      user: dbUser,
      password: dbPassword,
    });

    // Restart deployment to pick up new configuration
    console.log("Restarting deployment...");
    await kubeClient.restartDeployment(deploymentName, namespace);
  });

  test("Verify schemas were created", async () => {
    test.setTimeout(180000); // 3 minutes for RHDH to start and create schemas

    // Wait for RHDH to be ready
    const kubeClient = new KubeClient();
    await kubeClient.waitForDeploymentReady(deploymentName, namespace, 120000);

    // Verify schemas exist
    await verifySchemasExist({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    });
  });

  test("Verify no separate plugin databases were created", async () => {
    await verifyNoPluginDatabases({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
    });
  });

  test("Verify RHDH is accessible", async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });
});

/**
 * Update app-config ConfigMap to enable pluginDivisionMode: schema
 */
async function updateAppConfigForSchemaMode(
  kubeClient: KubeClient,
  namespace: string,
  dbConfig: {
    host: string;
    database: string;
    user: string;
    password: string;
  },
): Promise<void> {
  const configMapName = process.env.RELEASE_NAME
    ? `backstage-appconfig-${process.env.RELEASE_NAME}`
    : "backstage-appconfig-developer-hub";

  const configMap = await kubeClient.getConfigMap(configMapName, namespace);
  if (!configMap || !configMap.data) {
    throw new Error(`ConfigMap ${configMapName} not found`);
  }

  // Find the app-config key (could be app-config.yaml or app-config.local.yaml)
  const configKey = Object.keys(configMap.data).find((key) =>
    key.includes("app-config"),
  );
  if (!configKey) {
    throw new Error(`No app-config key found in ConfigMap ${configMapName}`);
  }

  // Parse YAML
  const appConfig = yaml.load(configMap.data[configKey]) as any;

  // Update database configuration
  if (!appConfig.backend) {
    appConfig.backend = {};
  }
  if (!appConfig.backend.database) {
    appConfig.backend.database = {};
  }

  appConfig.backend.database = {
    client: "pg",
    pluginDivisionMode: "schema",
    connection: {
      host: `\${POSTGRES_HOST}`,
      port: `\${POSTGRES_PORT}`,
      user: `\${POSTGRES_USER}`,
      password: `\${POSTGRES_PASSWORD}`,
      database: dbConfig.database,
    },
  };

  // Update ConfigMap data
  configMap.data[configKey] = yaml.dump(appConfig);

  // Remove metadata fields that shouldn't be in update
  delete configMap.metadata?.creationTimestamp;
  delete configMap.metadata?.resourceVersion;

  // Use replaceNamespacedConfigMap to update
  await kubeClient.coreV1Api.replaceNamespacedConfigMap(
    configMapName,
    namespace,
    configMap,
  );

  console.log(`ConfigMap ${configMapName} updated with schema mode configuration`);
}
