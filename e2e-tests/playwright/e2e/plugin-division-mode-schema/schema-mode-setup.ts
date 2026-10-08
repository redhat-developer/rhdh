/**
 * Shared setup utilities for schema mode E2E tests.
 * Handles database setup and RHDH configuration for both Helm and Operator deployments.
 */

import { base64Encode } from "../../utils/helper";
import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import { POSTGRES_ENV_KEYS } from "../../utils/postgres-config";
import type { AppConfigYaml } from "../../utils/runtime-config";
import {
  stopRuntimeApplication,
  resumeRuntimeApplication,
  setRuntimeDatabaseEnv,
} from "../../utils/runtime-lifecycle";
import {
  getSchemaModeEnv,
  connectAdminClient,
  cleanupOldPluginDatabases,
  setupSchemaModeDatabase,
} from "./schema-mode-db";

/** app-config `backend.database` for schema mode against the internal or an external DB. */
export function schemaModeDatabaseConfig(
  isInternalDb: boolean,
): NonNullable<NonNullable<AppConfigYaml["backend"]>["database"]> {
  return {
    client: "pg",
    pluginDivisionMode: "schema",
    ensureSchemaExists: true,
    connection: {
      host: "${POSTGRES_HOST}",
      port: "${POSTGRES_PORT}",
      user: "${POSTGRES_USER}",
      password: "${POSTGRES_PASSWORD}",
      database: "${POSTGRES_DB}",
      // Explicit for the internal DB, because pg otherwise falls back to
      // PGSSLMODE, which the external DB tests leave set to "require".
      ssl: isInternalDb ? false : { rejectUnauthorized: false },
    },
  };
}

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
    return "runtime-schema-credentials";
  }

  async setupDatabase(): Promise<void> {
    await stopRuntimeApplication(
      this.kubeClient,
      this.namespace,
      this.releaseName,
      this.installMethod,
    );
    console.log(`Connecting to PostgreSQL at ${this.env.dbHost}:5432...`);

    const adminClient = await connectAdminClient({
      dbHost: this.env.dbHost,
      dbAdminUser: this.env.dbAdminUser,
      dbAdminPassword: this.env.dbAdminPassword,
    });

    console.log("Connected to PostgreSQL");

    try {
      await cleanupOldPluginDatabases(adminClient);
      await setupSchemaModeDatabase(adminClient, this.env);
    } finally {
      await adminClient.end();
    }

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

    if (pfNamespace !== undefined && pfNamespace !== "" && pfNamespace !== this.namespace) {
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
   * 2. Set POSTGRES_* Secret references in the Helm Deployment or Operator CR
   * 3. Update the app-config ConfigMap for schema mode
   * 4. Resume the stopped deployment and await the current rollout
   */
  async configureRHDH(): Promise<void> {
    console.log(`Configuring RHDH for schema mode (${this.installMethod})...`);

    const secretName = this.getSecretName();
    const { host: rhdhPostgresHost, isInternal } = this.resolveRhdhPostgresHost();
    console.log(`RHDH pods will connect to PostgreSQL at: ${rhdhPostgresHost}`);

    const secretData: Record<string, string> = {
      password: base64Encode(this.env.dbPassword),
      "postgres-password": base64Encode(this.env.dbPassword),
      POSTGRES_PASSWORD: base64Encode(this.env.dbPassword),
      POSTGRES_DB: base64Encode(this.env.dbName),
      POSTGRES_USER: base64Encode(this.env.dbUser),
      POSTGRES_HOST: base64Encode(rhdhPostgresHost),
      POSTGRES_PORT: base64Encode("5432"),
    };

    await this.kubeClient.createOrUpdateSecret(
      {
        metadata: { name: secretName },
        data: secretData,
      },
      this.namespace,
    );
    console.log(`Updated secret ${secretName} with schema-mode credentials`);

    await setRuntimeDatabaseEnv(
      this.kubeClient,
      this.namespace,
      this.releaseName,
      this.installMethod,
      secretName,
      POSTGRES_ENV_KEYS,
    );

    await this.updateAppConfigForSchemaMode(isInternal);

    await resumeRuntimeApplication(
      this.kubeClient,
      this.namespace,
      this.releaseName,
      this.installMethod,
    );
  }

  private async updateAppConfigForSchemaMode(isInternalDb: boolean): Promise<void> {
    await this.kubeClient.patchAppConfig(this.namespace, (appConfig: AppConfigYaml) => {
      appConfig.backend ??= {};

      const currentDbConfig = appConfig.backend.database;
      const isAlreadyConfigured =
        currentDbConfig?.pluginDivisionMode === "schema" &&
        currentDbConfig?.ensureSchemaExists === true;

      if (isAlreadyConfigured) {
        console.log("App-config already configured for schema mode");
        return;
      }

      console.log("Updating app-config for schema mode...");
      console.log(
        isInternalDb
          ? "Using non-SSL connection for internal PostgreSQL"
          : "Using SSL connection for external PostgreSQL",
      );
      appConfig.backend.database = schemaModeDatabaseConfig(isInternalDb);
    });
    console.log("App-config updated for schema mode");
  }

  // fallow-ignore-next-line unused-class-member -- operator route discovery for future schema-mode specs
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
      const result = await adminClient.query<{ rolcreatedb: boolean; rolsuper: boolean }>(
        `SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname = $1`,
        [this.env.dbUser],
      );

      if (result.rows.length === 0) {
        throw new Error(`Database user "${this.env.dbUser}" not found`);
      }

      const hasCreateDb = result.rows[0].rolcreatedb || result.rows[0].rolsuper;
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

  async verifyPluginSchemas(): Promise<boolean> {
    const client = await connectAdminClient({
      dbHost: this.env.dbHost,
      dbAdminUser: this.env.dbAdminUser,
      dbAdminPassword: this.env.dbAdminPassword,
      database: this.env.dbName,
    });
    try {
      const schema = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'catalog'");
      if (schema.rows.length !== 1) return false;
      const migrations = await client.query<{ count: string }>(
        "SELECT count(*) FROM catalog.knex_migrations",
      );
      return Number(migrations.rows[0].count) > 0;
    } finally {
      await client.end();
    }
  }
}
