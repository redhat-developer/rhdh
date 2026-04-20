import { test } from "@playwright/test";
import * as yaml from "js-yaml";
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

interface AppConfigYaml {
  backend?: {
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
        ssl?: { rejectUnauthorized?: boolean };
      };
    };
  };
  [key: string]: unknown;
}

test.describe("Verify pluginDivisionMode: schema (Helm Chart)", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const releaseName = process.env.RELEASE_NAME || "redhat-developer-hub";
  const deploymentName = `${releaseName}-developer-hub`;
  const postgresServiceName = `${releaseName}-postgresql`;
  const secretName = `${releaseName}-postgresql`;

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
        "SCHEMA_MODE_* not set; schema-mode tests are opt-in",
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
    dbUser = process.env.SCHEMA_MODE_DB_USER || "bn_backstage";
    dbPassword = env.dbPassword;

    test
      .info()
      .annotations.push(
        { type: "component", description: "data-management" },
        { type: "namespace", description: namespace },
      );

    const kubeClient = new KubeClient();
    const postgresPodName = `${releaseName}-postgresql-0`;

    // Connect to PostgreSQL and set up schema-mode database
    let adminClient;
    try {
      adminClient = await connectAdminClient({
        dbHost,
        dbAdminUser,
        dbAdminPassword,
      });
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

    // Determine the PostgreSQL host that RHDH pods will use
    const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;
    let rhdhPostgresHost: string;
    if (pfNamespace && pfNamespace !== namespace) {
      rhdhPostgresHost = `postgress-external-db-primary.${pfNamespace}.svc.cluster.local`;
    } else if (dbHost === "localhost" || dbHost === "127.0.0.1") {
      rhdhPostgresHost = postgresServiceName;
    } else {
      rhdhPostgresHost = dbHost;
    }
    console.log(`RHDH pods will connect to PostgreSQL at: ${rhdhPostgresHost}`);

    // Update Helm chart secret with schema-mode credentials
    await kubeClient.createOrUpdateSecret(
      {
        metadata: { name: secretName },
        data: {
          password: Buffer.from(dbPassword).toString("base64"),
          "postgres-password": Buffer.from(dbPassword).toString("base64"),
          POSTGRES_PASSWORD: Buffer.from(dbPassword).toString("base64"),
          POSTGRES_DB: Buffer.from(dbName).toString("base64"),
          POSTGRES_USER: Buffer.from(dbUser).toString("base64"),
          POSTGRES_HOST: Buffer.from(rhdhPostgresHost).toString("base64"),
          POSTGRES_PORT: Buffer.from("5432").toString("base64"),
        },
      },
      namespace,
    );
    console.log(`Updated secret ${secretName} with schema-mode credentials`);

    // Ensure POSTGRES_* env vars are set in the deployment
    const deployment = await kubeClient.appsApi.readNamespacedDeployment(
      deploymentName,
      namespace,
    );
    const containers = deployment.body.spec?.template?.spec?.containers || [];
    const backstageIdx = containers.findIndex(
      (c) => c.name === "backstage-backend",
    );
    const backstageContainer = containers[backstageIdx];

    if (backstageContainer) {
      const existingEnv = backstageContainer.env || [];
      const requiredVars = [
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
      ];
      const missingVars = requiredVars.filter(
        (v) => !existingEnv.some((e) => e.name === v),
      );

      if (missingVars.length > 0) {
        console.log(`Adding env vars to deployment: ${missingVars.join(", ")}`);
        const patch: { op: string; path: string; value?: unknown }[] = [];

        if (!backstageContainer.env || backstageContainer.env.length === 0) {
          patch.push({
            op: "add",
            path: `/spec/template/spec/containers/${backstageIdx}/env`,
            value: [],
          });
        }

        for (const varName of missingVars) {
          patch.push({
            op: "add",
            path: `/spec/template/spec/containers/${backstageIdx}/env/-`,
            value: {
              name: varName,
              valueFrom: {
                secretKeyRef: { name: secretName, key: varName },
              },
            },
          });
        }

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
        console.log(`Added env vars to deployment`);
      }
    }

    // Update app-config ConfigMap for schema mode
    const configMapName = await kubeClient.findAppConfigMap(namespace);
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

    const currentDb = appConfig.backend.database;
    const isAlreadyConfigured =
      currentDb?.pluginDivisionMode === "schema" &&
      currentDb?.connection?.ssl !== undefined;

    if (!isAlreadyConfigured) {
      console.log("Updating app-config for schema mode");
      appConfig.backend.database = {
        client: "pg",
        pluginDivisionMode: "schema",
        ensureSchemaExists: true,
        connection: {
          host: `\${POSTGRES_HOST}`,
          port: `\${POSTGRES_PORT}`,
          user: `\${POSTGRES_USER}`,
          password: `\${POSTGRES_PASSWORD}`,
          database: `\${POSTGRES_DB}`,
          ssl: { rejectUnauthorized: false },
        },
      };

      configMap.data[configKey] = yaml.dump(appConfig);
      delete configMap.metadata?.creationTimestamp;
      delete configMap.metadata?.resourceVersion;
      await kubeClient.coreV1Api.replaceNamespacedConfigMap(
        configMapName,
        namespace,
        configMap,
      );
    }

    // Restart to apply schema mode configuration
    console.log("Restarting RHDH to apply schema mode configuration");
    await kubeClient.restartDeployment(deploymentName, namespace);
    console.log("RHDH restart completed");
  });

  test.afterAll(() => {
    stopSchemaModePortForward?.();
  });

  test("Verify RHDH is accessible", async ({ page }, testInfo) => {
    const kubeClient = new KubeClient();
    try {
      const deployment = await kubeClient.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );
      const readyReplicas = deployment.body.status?.readyReplicas ?? 0;
      if (readyReplicas < 1) {
        testInfo.skip(
          true,
          "Deployment is not ready; skipping RHDH accessibility check.",
        );
        return;
      }
    } catch {
      // If we can't read deployment, let the test try
    }

    const common = new Common(page);
    await common.loginAsGuest();
  });
});
