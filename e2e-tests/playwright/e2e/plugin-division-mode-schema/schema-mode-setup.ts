/**
 * Shared setup utilities for schema mode E2E tests.
 * Handles database setup and RHDH configuration for both Helm and Operator deployments.
 */

import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import { base64Encode } from "../../utils/helper";
import type { AppConfigYaml } from "../../utils/runtime-config";
import {
  getSchemaModeEnv,
  connectAdminClient,
  cleanupOldPluginDatabases,
  setupSchemaModeDatabase,
} from "./schema-mode-db";


export class SchemaModeTestSetup {
  private namespace: string;
  private releaseName: string;
  private installMethod: "helm" | "operator";
  private env: ReturnType<typeof getSchemaModeEnv>;
  private kubeClient: KubeClient;

  constructor(namespace: string, releaseName: string, installMethod: "helm" | "operator") {
    this.namespace = namespace;
    this.releaseName = releaseName;
    this.installMethod = installMethod;
    this.env = getSchemaModeEnv();
    this.kubeClient = new KubeClient();
  }

  getDeploymentName(): string {
    return getRhdhDeploymentName();
  }

  private getSecretName(): string {
    if (this.installMethod === "operator") {
      return `backstage-psql-secret-${this.releaseName}`;
    }
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
   * Resolve the PostgreSQL host that RHDH pods should use (in-cluster DNS)
   * and whether the target is the Helm sub-chart's internal PostgreSQL.
   * The test runner connects via localhost port-forward, but pods need the
   * cluster-internal address.
   */
  private resolveRhdhPostgresHost(): { host: string; isInternal: boolean } {
    const pfNamespace = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;

    if (pfNamespace && pfNamespace !== this.namespace) {
      return {
        host: `postgress-external-db-primary.${pfNamespace}.svc.cluster.local`,
        isInternal: false,
      };
    }

    if (this.env.dbHost === "localhost" || this.env.dbHost === "127.0.0.1") {
      const host =
        this.installMethod === "operator"
          ? `backstage-psql-${this.releaseName}`
          : `${this.releaseName}-postgresql`;
      return { host, isInternal: true };
    }

    return { host: this.env.dbHost, isInternal: false };
  }

  /**
   * Configure RHDH for schema mode:
   * 1. Update the Secret with schema-mode test user credentials
   * 2. Patch the Deployment to inject POSTGRES_* env vars from the Secret (Helm only)
   * 3. Update the app-config ConfigMap for schema mode
   * 4. Restart the deployment (with retry for operator reconciliation)
   */
  async configureRHDH(): Promise<void> {
    console.log(`Configuring RHDH for schema mode (${this.installMethod})...`);

    const deploymentName = this.getDeploymentName();
    const secretName = this.getSecretName();
    const { host: rhdhPostgresHost, isInternal } =
      this.resolveRhdhPostgresHost();
    console.log(`RHDH pods will connect to PostgreSQL at: ${rhdhPostgresHost}`);

    // 1. Update secret with schema-mode credentials.
    //    For operator: the operator injects env vars from the managed secret
    //    via envFrom, so we must preserve keys the PostgreSQL image needs
    //    (POSTGRESQL_ADMIN_PASSWORD) while adding/overriding POSTGRES_* keys.
    const secretData: Record<string, string> = {
      password: base64Encode(this.env.dbPassword),
      "postgres-password": base64Encode(this.env.dbPassword),
      POSTGRES_PASSWORD: base64Encode(this.env.dbPassword),
      POSTGRES_DB: base64Encode(this.env.dbName),
      POSTGRES_USER: base64Encode(this.env.dbUser),
      POSTGRES_HOST: base64Encode(rhdhPostgresHost),
      POSTGRES_PORT: base64Encode("5432"),
    };

    if (this.installMethod === "operator") {
      // Preserve POSTGRESQL_ADMIN_PASSWORD — the operator-managed PostgreSQL
      // image reads this on startup (set_passwords.sh). Without it the
      // StatefulSet pod fails to start.
      try {
        const existing = await this.kubeClient.coreV1Api.readNamespacedSecret(
          secretName,
          this.namespace,
        );
        const existingData = existing.body.data || {};
        if (existingData.POSTGRESQL_ADMIN_PASSWORD) {
          secretData.POSTGRESQL_ADMIN_PASSWORD =
            existingData.POSTGRESQL_ADMIN_PASSWORD;
        }
      } catch {
        console.warn(
          `Could not read existing secret ${secretName}; POSTGRESQL_ADMIN_PASSWORD may be lost`,
        );
      }
    }

    await this.kubeClient.createOrUpdateSecret(
      {
        metadata: { name: secretName },
        data: secretData,
      },
      this.namespace,
    );
    console.log(`Updated secret ${secretName} with schema-mode credentials`);

    // 2. Ensure POSTGRES_* env vars are set in the deployment (Helm only).
    //    Operator deployments inject env vars from the managed secret via
    //    envFrom in the StatefulSet/Deployment spec. Patching the Deployment
    //    directly would be reverted by operator reconciliation.
    if (this.installMethod !== "operator") {
      await this.ensureDeploymentEnvVars(deploymentName, secretName);
    } else {
      console.log(
        "Skipping Deployment env var patching (operator injects env vars from secret via extraEnvs.secrets)",
      );
    }

    // 3. Update app-config ConfigMap for schema mode
    await this.updateAppConfigForSchemaMode(isInternal);

    // 4. Restart to apply changes (with retry for operator reconciliation)
    await this.kubeClient.restartDeploymentWithRetry(
      deploymentName,
      this.namespace,
    );
  }

  private async ensureDeploymentEnvVars(deploymentName: string, secretName: string): Promise<void> {
    const deployment = await this.kubeClient.appsApi.readNamespacedDeployment(
      deploymentName,
      this.namespace,
    );
    const containers = deployment.body.spec?.template?.spec?.containers ?? [];
    const backstageContainer = containers.find((c) => c.name === "backstage-backend");
    const backstageIdx = containers.findIndex((c) => c.name === "backstage-backend");

    if (backstageContainer === undefined) {
      console.warn("backstage-backend container not found in deployment");
    } else {
      const existingEnv = backstageContainer.env ?? [];
      const requiredVars = [
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
      ];
      const missingVars = requiredVars.filter((v) => !existingEnv.some((e) => e.name === v));

      if (missingVars.length === 0) {
        console.log("POSTGRES_* env vars already present in deployment");
        return;
      }

      console.log(`Adding env vars to deployment: ${missingVars.join(", ")}`);
      const patch: { op: string; path: string; value?: unknown }[] = [];

      if (backstageContainer.env === undefined || backstageContainer.env.length === 0) {
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

      await this.kubeClient.jsonPatchDeployment(
        deploymentName,
        this.namespace,
        patch,
      );
      console.log("Added env vars to deployment");
    }
  }

  private async updateAppConfigForSchemaMode(
    isInternalDb: boolean,
  ): Promise<void> {
    await this.kubeClient.patchAppConfig(
      this.namespace,
      (appConfig: AppConfigYaml) => {
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
        const connection: Record<string, unknown> = {
          host: "${POSTGRES_HOST}",
          port: "${POSTGRES_PORT}",
          user: "${POSTGRES_USER}",
          password: "${POSTGRES_PASSWORD}",
          database: "${POSTGRES_DB}",
        };

        if (isInternalDb) {
          console.log("Using non-SSL connection for internal PostgreSQL");
        } else {
          connection.ssl = { rejectUnauthorized: false };
          console.log("Using SSL connection for external PostgreSQL");
        }

        appConfig.backend.database = {
          client: "pg",
          pluginDivisionMode: "schema",
          ensureSchemaExists: true,
          connection,
        };
      },
    );
    console.log("App-config updated for schema mode");
  }

  async getRHDHUrl(): Promise<string> {
    const routeNames =
      this.installMethod === "operator"
        ? [`backstage-${this.releaseName}`, `${this.releaseName}-developer-hub`]
        : [`${this.releaseName}-developer-hub`, `backstage-${this.releaseName}`];

    for (const routeName of routeNames) {
      try {
        const route = (await this.kubeClient.customObjectsApi.getNamespacedCustomObject(
          "route.openshift.io",
          "v1",
          this.namespace,
          "routes",
          routeName,
        )) as { body?: { spec?: { host?: string } } };

        const routeHost = route.body?.spec?.host;
        if (routeHost !== undefined && routeHost !== "") {
          const url = `https://${routeHost}`;
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
        console.log(`Database user "${this.env.dbUser}" has restricted permissions (NOCREATEDB)`);
        return true;
      }
      console.warn(`Database user "${this.env.dbUser}" has CREATEDB privilege`);
      return false;
    } finally {
      await adminClient.end();
    }
  }
}
