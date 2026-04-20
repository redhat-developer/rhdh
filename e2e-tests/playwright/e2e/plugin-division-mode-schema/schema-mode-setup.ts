/**
 * Shared setup utilities for schema mode E2E tests.
 * Handles database setup and RHDH configuration for both Helm and Operator deployments.
 */

import * as yaml from "js-yaml";
import { KubeClient } from "../../utils/kube-client";
import {
  getSchemaModeEnv,
  connectAdminClient,
  cleanupOldPluginDatabases,
  setupSchemaModeDatabase,
} from "./schema-mode-db";

interface AppConfigYaml {
  backend?: {
    database?: {
      client?: string;
      pluginDivisionMode?: string;
      ensureSchemaExists?: boolean;
      connection?: Record<string, unknown>;
    };
  };
  [key: string]: unknown;
}

export class SchemaModeTestSetup {
  private namespace: string;
  private releaseName: string;
  private installMethod: "helm" | "operator";
  private env: ReturnType<typeof getSchemaModeEnv>;
  private kubeClient: KubeClient;

  constructor(
    namespace: string,
    releaseName: string,
    installMethod: "helm" | "operator",
  ) {
    this.namespace = namespace;
    this.releaseName = releaseName;
    this.installMethod = installMethod;
    this.env = getSchemaModeEnv();
    this.kubeClient = new KubeClient();
  }

  getDeploymentName(): string {
    if (this.installMethod === "operator") {
      return `backstage-${this.releaseName}`;
    }
    return `${this.releaseName}-developer-hub`;
  }

  private getSecretName(): string {
    return `${this.releaseName}-postgresql`;
  }

  async setupDatabase(): Promise<void> {
    console.log(`Connecting to PostgreSQL at ${this.env.dbHost}:5432...`);

    const adminClient = await connectAdminClient({
      dbHost: this.env.dbHost,
      dbAdminUser: this.env.dbAdminUser,
      dbAdminPassword: this.env.dbAdminPassword,
    });

    console.log("Connected to PostgreSQL");

    await cleanupOldPluginDatabases(adminClient);
    await setupSchemaModeDatabase(adminClient, this.env);

    console.log("Database setup complete");
  }

  /**
   * Resolve the PostgreSQL host that RHDH pods should use (in-cluster DNS).
   * The test runner connects via localhost port-forward, but pods need the
   * cluster-internal address.
   */
  private resolveRhdhPostgresHost(): string {
    const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;

    if (pfNamespace && pfNamespace !== this.namespace) {
      return `postgress-external-db-primary.${pfNamespace}.svc.cluster.local`;
    }

    if (this.env.dbHost === "localhost" || this.env.dbHost === "127.0.0.1") {
      return `${this.releaseName}-postgresql`;
    }

    return this.env.dbHost;
  }

  /**
   * Configure RHDH for schema mode:
   * 1. Update the Secret with schema-mode test user credentials
   * 2. Patch the Deployment to inject POSTGRES_* env vars from the Secret
   * 3. Update the app-config ConfigMap for schema mode
   * 4. Restart the deployment
   */
  async configureRHDH(): Promise<void> {
    console.log("Configuring RHDH for schema mode...");

    const deploymentName = this.getDeploymentName();
    const secretName = this.getSecretName();
    const rhdhPostgresHost = this.resolveRhdhPostgresHost();
    console.log(`RHDH pods will connect to PostgreSQL at: ${rhdhPostgresHost}`);

    // 1. Update secret with schema-mode credentials
    await this.kubeClient.createOrUpdateSecret(
      {
        metadata: { name: secretName },
        data: {
          password: Buffer.from(this.env.dbPassword).toString("base64"),
          "postgres-password": Buffer.from(this.env.dbPassword).toString(
            "base64",
          ),
          POSTGRES_PASSWORD: Buffer.from(this.env.dbPassword).toString(
            "base64",
          ),
          POSTGRES_DB: Buffer.from(this.env.dbName).toString("base64"),
          POSTGRES_USER: Buffer.from(this.env.dbUser).toString("base64"),
          POSTGRES_HOST: Buffer.from(rhdhPostgresHost).toString("base64"),
          POSTGRES_PORT: Buffer.from("5432").toString("base64"),
        },
      },
      this.namespace,
    );
    console.log(`Updated secret ${secretName} with schema-mode credentials`);

    // 2. Ensure POSTGRES_* env vars are set in the deployment
    await this.ensureDeploymentEnvVars(deploymentName, secretName);

    // 3. Update app-config ConfigMap for schema mode
    await this.updateAppConfigForSchemaMode();

    // 4. Restart to apply changes
    console.log("Restarting RHDH to apply schema mode configuration...");
    await this.kubeClient.restartDeployment(deploymentName, this.namespace);
    console.log("RHDH restart completed");
  }

  private async ensureDeploymentEnvVars(
    deploymentName: string,
    secretName: string,
  ): Promise<void> {
    const deployment = await this.kubeClient.appsApi.readNamespacedDeployment(
      deploymentName,
      this.namespace,
    );
    const containers = deployment.body.spec?.template?.spec?.containers || [];
    const backstageIdx = containers.findIndex(
      (c) => c.name === "backstage-backend",
    );
    const backstageContainer = containers[backstageIdx];

    if (!backstageContainer) {
      console.warn("backstage-backend container not found in deployment");
      return;
    }

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

    if (missingVars.length === 0) {
      console.log("POSTGRES_* env vars already present in deployment");
      return;
    }

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

    await this.kubeClient.appsApi.patchNamespacedDeployment(
      deploymentName,
      this.namespace,
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/json-patch+json" } },
    );
    console.log("Added env vars to deployment");
  }

  private async updateAppConfigForSchemaMode(): Promise<void> {
    const configMapName = await this.kubeClient.findAppConfigMap(
      this.namespace,
    );
    let configMapResponse;

    try {
      configMapResponse = await this.kubeClient.getConfigMap(
        configMapName,
        this.namespace,
      );
    } catch {
      throw new Error(
        `ConfigMap '${configMapName}' not found in namespace '${this.namespace}'. ` +
          `Ensure RHDH is deployed before running schema mode tests.`,
      );
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

    const currentDbConfig = appConfig.backend.database;
    const isAlreadyConfigured =
      currentDbConfig?.pluginDivisionMode === "schema" &&
      currentDbConfig?.ensureSchemaExists === true;

    if (isAlreadyConfigured) {
      console.log("App-config already configured for schema mode");
      return;
    }

    console.log("Updating app-config for schema mode...");
    appConfig.backend.database = {
      client: "pg",
      pluginDivisionMode: "schema",
      ensureSchemaExists: true,
      connection: {
        host: "${POSTGRES_HOST}",
        port: "${POSTGRES_PORT}",
        user: "${POSTGRES_USER}",
        password: "${POSTGRES_PASSWORD}",
        database: "${POSTGRES_DB}",
        ssl: { rejectUnauthorized: false },
      },
    };

    configMap.data[configKey] = yaml.dump(appConfig);
    delete configMap.metadata?.creationTimestamp;
    delete configMap.metadata?.resourceVersion;

    await this.kubeClient.coreV1Api.replaceNamespacedConfigMap(
      configMapName,
      this.namespace,
      configMap,
    );
    console.log("App-config updated for schema mode");
  }

  async getRHDHUrl(): Promise<string> {
    const routeNames =
      this.installMethod === "operator"
        ? [`backstage-${this.releaseName}`, `${this.releaseName}-developer-hub`]
        : [
            `${this.releaseName}-developer-hub`,
            `backstage-${this.releaseName}`,
          ];

    for (const routeName of routeNames) {
      try {
        const route =
          (await this.kubeClient.customObjectsApi.getNamespacedCustomObject(
            "route.openshift.io",
            "v1",
            this.namespace,
            "routes",
            routeName,
          )) as { body?: { spec?: { host?: string } } };

        if (route?.body?.spec?.host) {
          const url = `https://${route.body.spec.host}`;
          console.log(`Found RHDH URL: ${url}`);
          return url;
        }
      } catch {
        continue;
      }
    }

    throw new Error(
      `Could not find OpenShift Route for RHDH in namespace ${this.namespace}. ` +
        `Set BASE_URL environment variable manually.`,
    );
  }

  async verifyRestrictedDatabasePermissions(): Promise<boolean> {
    const adminClient = await connectAdminClient({
      dbHost: this.env.dbHost,
      dbAdminUser: this.env.dbAdminUser,
      dbAdminPassword: this.env.dbAdminPassword,
    });

    try {
      const result = await adminClient.query<{ rolcreatedb: boolean }>(
        `SELECT rolcreatedb FROM pg_roles WHERE rolname = $1`,
        [this.env.dbUser],
      );

      if (result.rows.length === 0) {
        throw new Error(`Database user "${this.env.dbUser}" not found`);
      }

      const hasCreateDb = result.rows[0].rolcreatedb;
      if (!hasCreateDb) {
        console.log(
          `Database user "${this.env.dbUser}" has restricted permissions (NOCREATEDB)`,
        );
        return true;
      } else {
        console.warn(
          `Database user "${this.env.dbUser}" has CREATEDB privilege`,
        );
        return false;
      }
    } finally {
      await adminClient.end();
    }
  }
}
