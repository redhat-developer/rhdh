import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getSecretsManager } from '../utils/secrets-manager.js';

const execAsync = promisify(exec);

/**
 * Schema for auth provider configuration
 */
const AuthProviderSchema = z.object({
  github: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      enabled: z.boolean().default(false),
    })
    .optional(),
  google: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      enabled: z.boolean().default(false),
    })
    .optional(),
  keycloak: z
    .object({
      baseUrl: z.string().optional(),
      realm: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      enabled: z.boolean().default(false),
    })
    .optional(),
  oidc: z
    .object({
      issuer: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      enabled: z.boolean().default(false),
    })
    .optional(),
});

/**
 * Schema for database configuration
 */
const DatabaseConfigSchema = z.object({
  type: z.enum(['local', 'rds', 'external']),
  host: z.string().optional(),
  port: z.number().default(5432),
  database: z.string().default('backstage'),
  username: z.string().default('postgres'),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  sslCertPath: z.string().optional(),
});

type AuthProviderConfig = z.infer<typeof AuthProviderSchema>;
type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export class UtilityService {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Configure authentication providers
   */
  async configureAuthProviders(namespace: string, providers: AuthProviderConfig): Promise<void> {
    console.log(`🔐 Configuring authentication providers for namespace: ${namespace}`);

    const secretsManager = getSecretsManager();
    const enabledProviders: string[] = [];

    // Create auth secrets
    if (providers.github?.enabled) {
      const githubConfig = secretsManager.getGitHubConfig();
      await this.createSecret(namespace, 'github-auth-secret', {
        clientId: providers.github.clientId || githubConfig.clientId,
        clientSecret: providers.github.clientSecret || githubConfig.clientSecret,
      });
      enabledProviders.push('github');
    }

    if (providers.google?.enabled) {
      // Google config can be added to secrets manager if needed
      await this.createSecret(namespace, 'google-auth-secret', {
        clientId: providers.google.clientId || secretsManager.getSecret('GOOGLE_CLIENT_ID', ''),
        clientSecret:
          providers.google.clientSecret || secretsManager.getSecret('GOOGLE_CLIENT_SECRET', ''),
      });
      enabledProviders.push('google');
    }

    if (providers.keycloak?.enabled) {
      const keycloakConfig = secretsManager.getKeycloakConfig();
      await this.createSecret(namespace, 'keycloak-auth-secret', {
        baseUrl: providers.keycloak.baseUrl || keycloakConfig.baseUrl,
        realm: providers.keycloak.realm || keycloakConfig.realm,
        clientId: providers.keycloak.clientId || keycloakConfig.clientId,
        clientSecret: providers.keycloak.clientSecret || keycloakConfig.clientSecret,
      });
      enabledProviders.push('keycloak');
    }

    if (providers.oidc?.enabled) {
      await this.createSecret(namespace, 'oidc-auth-secret', {
        issuer: providers.oidc.issuer || secretsManager.getSecret('OIDC_ISSUER', ''),
        clientId: providers.oidc.clientId || secretsManager.getSecret('OIDC_CLIENT_ID', ''),
        clientSecret:
          providers.oidc.clientSecret || secretsManager.getSecret('OIDC_CLIENT_SECRET', ''),
      });
      enabledProviders.push('oidc');
    }

    console.log(`✅ Enabled auth providers: ${enabledProviders.join(', ')}`);
  }

  /**
   * Setup database
   */
  async setupDatabase(namespace: string, config: DatabaseConfig): Promise<void> {
    console.log(`🗄️  Setting up database for namespace: ${namespace}`);

    switch (config.type) {
      case 'local':
        await this.setupLocalDatabase(namespace);
        break;

      case 'rds':
        await this.setupRDSDatabase(namespace, config);
        break;

      case 'external':
        await this.setupExternalDatabase(namespace, config);
        break;
    }
  }

  /**
   * Setup local PostgreSQL database
   */
  private async setupLocalDatabase(namespace: string): Promise<void> {
    console.log('Setting up local PostgreSQL database...');

    // Apply PostgreSQL manifest
    const postgresManifest = path.join(
      this.workspaceRoot,
      '.ibm/pipelines/resources/postgres-db/postgres.yaml'
    );

    await execAsync(`kubectl apply -f ${postgresManifest} -n ${namespace}`);

    // Wait for PostgreSQL to be ready
    await this.waitForDeployment(namespace, 'postgres', 300);

    // Get database configuration from secrets manager
    const secretsManager = getSecretsManager();
    const dbConfig = secretsManager.getDatabaseConfig();

    // Create database credentials secret
    await this.createSecret(namespace, 'postgres-secrets', {
      POSTGRES_USER: dbConfig.user,
      POSTGRES_PASSWORD: dbConfig.password,
    });
  }

  /**
   * Setup RDS database
   */
  private async setupRDSDatabase(namespace: string, config: DatabaseConfig): Promise<void> {
    console.log('Setting up RDS database connection...');

    // Get database configuration from secrets manager
    const secretsManager = getSecretsManager();
    const dbConfig = secretsManager.getDatabaseConfig();

    // Create RDS certificate if provided
    if (config.sslCertPath) {
      const certContent = await fs.readFile(config.sslCertPath, 'utf-8');
      await this.createSecret(namespace, 'postgres-crt', {
        'rds-ca-bundle.pem': certContent,
      });
    }

    // Create database connection secret using secrets manager
    await this.createSecret(namespace, 'postgres-secrets', {
      POSTGRES_HOST: dbConfig.host,
      POSTGRES_PORT: dbConfig.port.toString(),
      POSTGRES_USER: dbConfig.user,
      POSTGRES_PASSWORD: dbConfig.password,
    });

    // Apply RDS config
    const rdsConfig = path.join(
      this.workspaceRoot,
      '.ibm/pipelines/resources/postgres-db/rds-app-config.yaml'
    );

    await execAsync(`kubectl apply -f ${rdsConfig} -n ${namespace}`);
  }

  /**
   * Setup external database connection
   */
  private async setupExternalDatabase(namespace: string, config: DatabaseConfig): Promise<void> {
    console.log('Setting up external database connection...');

    // Get database configuration from secrets manager
    const secretsManager = getSecretsManager();
    const dbConfig = secretsManager.getDatabaseConfig();

    await this.createSecret(namespace, 'postgres-secrets', {
      POSTGRES_HOST: dbConfig.host,
      POSTGRES_PORT: dbConfig.port.toString(),
      POSTGRES_USER: dbConfig.user,
      POSTGRES_PASSWORD: dbConfig.password,
      POSTGRES_DATABASE: dbConfig.database,
    });
  }

  /**
   * Clear database
   */
  async clearDatabase(namespace: string, releaseName: string): Promise<void> {
    console.log(`🧹 Clearing database for ${releaseName} in namespace: ${namespace}`);

    try {
      // Get database configuration from secrets manager
      const secretsManager = getSecretsManager();
      const dbConfig = secretsManager.getDatabaseConfig();

      // Get postgres pod
      const { stdout } = await execAsync(
        `kubectl get pods -n ${namespace} -l app=postgres -o jsonpath='{.items[0].metadata.name}'`
      );

      const postgresPod = stdout.trim();
      if (!postgresPod) {
        console.log('No PostgreSQL pod found, skipping database clear');
        return;
      }

      // Clear database using secrets from secrets manager
      const clearCommand = `
        PGPASSWORD=${dbConfig.password} psql -U ${dbConfig.user} -d ${dbConfig.database} -c "
          TRUNCATE TABLE app_metadata CASCADE;
          TRUNCATE TABLE final_entities CASCADE;
          TRUNCATE TABLE refresh_state CASCADE;
          TRUNCATE TABLE relations CASCADE;
          TRUNCATE TABLE search CASCADE;
        "
      `;

      await execAsync(`kubectl exec -n ${namespace} ${postgresPod} -- bash -c "${clearCommand}"`);
      console.log('✅ Database cleared successfully');
    } catch (error) {
      console.error('Failed to clear database:', error);
      throw error;
    }
  }

  /**
   * Setup Redis cache
   */
  async setupRedisCache(namespace: string): Promise<void> {
    console.log(`📦 Setting up Redis cache for namespace: ${namespace}`);

    // Apply Redis manifests
    const redisFiles = [
      'resources/redis-cache/redis-secret.yaml',
      'resources/redis-cache/redis-deployment.yaml',
    ];

    for (const file of redisFiles) {
      const manifestPath = path.join(this.workspaceRoot, '.ibm/pipelines', file);
      await execAsync(`kubectl apply -f ${manifestPath} -n ${namespace}`);
    }

    // Wait for Redis to be ready
    await this.waitForDeployment(namespace, 'redis', 120);
    console.log('✅ Redis cache setup completed');
  }

  /**
   * Create Kubernetes secret
   */
  private async createSecret(
    namespace: string,
    name: string,
    data: Record<string, string>
  ): Promise<void> {
    const args = [
      'create',
      'secret',
      'generic',
      name,
      '-n',
      namespace,
      '--dry-run=client',
      '-o',
      'yaml',
    ];

    for (const [key, value] of Object.entries(data)) {
      args.push(`--from-literal=${key}=${value}`);
    }

    const { stdout } = await execAsync(`kubectl ${args.join(' ')}`);
    await execAsync(`echo '${stdout}' | kubectl apply -f -`);
  }

  /**
   * Wait for deployment to be ready
   */
  private async waitForDeployment(
    namespace: string,
    deploymentName: string,
    timeoutSeconds: number
  ): Promise<void> {
    console.log(`⏳ Waiting for ${deploymentName} to be ready...`);

    await execAsync(
      `kubectl wait --for=condition=available --timeout=${timeoutSeconds}s deployment/${deploymentName} -n ${namespace}`
    );
  }

  /**
   * Setup showcase test applications
   */
  async setupShowcaseApps(namespace: string): Promise<void> {
    console.log(`🎭 Setting up showcase test applications for namespace: ${namespace}`);

    // Apply topology test deployment
    const topologyFiles = [
      'resources/topology_test/topology-test.yaml',
      'resources/topology_test/topology-test-route.yaml',
    ];

    for (const file of topologyFiles) {
      const manifestPath = path.join(this.workspaceRoot, '.ibm/pipelines', file);
      try {
        await execAsync(`kubectl apply -f ${manifestPath} -n ${namespace}`);
      } catch (error) {
        console.warn(`Warning: Failed to apply ${file}:`, error);
      }
    }

    console.log('✅ Showcase applications setup completed');
  }

  /**
   * Configure RBAC
   */
  async configureRBAC(namespace: string): Promise<void> {
    console.log(`🔒 Configuring RBAC for namespace: ${namespace}`);

    // Apply RBAC policy ConfigMap
    const rbacPolicyPath = path.join(
      this.workspaceRoot,
      '.ibm/pipelines/resources/config_map/rbac-policy.csv'
    );

    // Read RBAC policy
    const rbacPolicy = await fs.readFile(rbacPolicyPath, 'utf-8');

    // Create ConfigMap with RBAC policy
    await this.createConfigMap(namespace, 'rbac-policy', {
      'rbac-policy.csv': rbacPolicy,
    });

    console.log('✅ RBAC configuration completed');
  }

  /**
   * Create ConfigMap
   */
  private async createConfigMap(
    namespace: string,
    name: string,
    data: Record<string, string>
  ): Promise<void> {
    const args = ['create', 'configmap', name, '-n', namespace, '--dry-run=client', '-o', 'yaml'];

    for (const [key, value] of Object.entries(data)) {
      args.push(`--from-literal=${key}=${value}`);
    }

    const { stdout } = await execAsync(`kubectl ${args.join(' ')}`);
    await execAsync(`echo '${stdout}' | kubectl apply -f -`);
  }

  /**
   * Configure dynamic plugins
   */
  async configureDynamicPlugins(namespace: string): Promise<void> {
    console.log(`🔌 Configuring dynamic plugins for namespace: ${namespace}`);

    const pluginFiles = [
      'resources/config_map/dynamic-plugins-config.yaml',
      'resources/config_map/dynamic-global-header-config.yaml',
      'resources/config_map/dynamic-global-floating-action-button-config.yaml',
    ];

    for (const file of pluginFiles) {
      const manifestPath = path.join(this.workspaceRoot, '.ibm/pipelines', file);
      await execAsync(`kubectl apply -f ${manifestPath} -n ${namespace}`);
    }

    // Create PVC for plugins
    const pvcPath = path.join(
      this.workspaceRoot,
      '.ibm/pipelines/resources/postgres-db/dynamic-plugins-root-PVC.yaml'
    );
    await execAsync(`kubectl apply -f ${pvcPath} -n ${namespace}`);

    console.log('✅ Dynamic plugins configuration completed');
  }
}
