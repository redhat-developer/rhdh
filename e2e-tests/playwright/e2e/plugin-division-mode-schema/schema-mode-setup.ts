/**
 * Shared setup utilities for schema mode E2E tests.
 * Handles database setup and RHDH configuration for both Helm and Operator deployments.
 */

import * as yaml from "js-yaml";
import { Client } from "pg";
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

  /**
   * Get the deployment name based on install method
   */
  getDeploymentName(): string {
    if (this.installMethod === "operator") {
      return `backstage-${this.releaseName}`;
    }
    return this.releaseName;
  }

  /**
   * Get the ConfigMap name based on install method
   */
  private getConfigMapName(): string {
    if (this.installMethod === "operator") {
      return `backstage-appconfig-${this.releaseName}`;
    }
    return `${this.releaseName}-app-config`;
  }

  /**
   * Setup database: clean old databases, create test database, configure user
   */
  async setupDatabase(): Promise<void> {
    console.log(`Connecting to PostgreSQL at ${this.env.dbHost}:5432...`);

    const adminClient = await connectAdminClient({
      dbHost: this.env.dbHost,
      dbAdminUser: this.env.dbAdminUser,
      dbAdminPassword: this.env.dbAdminPassword,
    });

    console.log("✓ Connected to PostgreSQL");

    await cleanupOldPluginDatabases(adminClient);
    await setupSchemaModeDatabase(adminClient, this.env);

    console.log("✓ Database setup complete");
  }

  /**
   * Configure RHDH for schema mode by updating ConfigMap and restarting deployment
   */
  async configureRHDH(): Promise<void> {
    console.log("Configuring RHDH for schema mode...");

    const configMapName = this.getConfigMapName();
    let configMapResponse;

    try {
      configMapResponse = await this.kubeClient.getConfigMap(
        configMapName,
        this.namespace,
      );
    } catch (err) {
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

    if (!isAlreadyConfigured) {
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
          ssl: {
            rejectUnauthorized: false,
          },
        },
      };

      const newConfigYaml = yaml.dump(appConfig);
      try {
        yaml.load(newConfigYaml);
      } catch (error) {
        throw new Error(
          `Generated invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      configMap.data[configKey] = newConfigYaml;
      delete configMap.metadata?.creationTimestamp;
      delete configMap.metadata?.resourceVersion;

      await this.kubeClient.coreV1Api.replaceNamespacedConfigMap(
        configMapName,
        this.namespace,
        configMap,
      );

      console.log("✓ App-config updated for schema mode");

      console.log("Restarting RHDH to apply schema mode configuration...");
      const deploymentName = this.getDeploymentName();

      await this.kubeClient.restartDeployment(deploymentName, this.namespace);
      console.log("✓ RHDH restart completed");
    } else {
      console.log("✓ RHDH already configured for schema mode");
    }
  }

  /**
   * Get RHDH URL from OpenShift Route
   */
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
          console.log(`✓ Found RHDH URL: ${url}`);
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

  /**
   * Verify that the database user has restricted permissions (NOCREATEDB)
   */
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
          `✓ Database user "${this.env.dbUser}" has restricted permissions (NOCREATEDB)`,
        );
        return true;
      } else {
        console.warn(
          `⚠ Database user "${this.env.dbUser}" has CREATEDB privilege`,
        );
        return false;
      }
    } finally {
      await adminClient.end();
    }
  }
}
