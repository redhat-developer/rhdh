import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { createLogger } from './logger.js';

const logger = createLogger({ component: 'secrets' });

/**
 * Secrets Manager - handles reading secrets from environment or files
 * Following the same pattern used in .ibm/pipelines/env_variables.sh
 */
export class SecretsManager {
  private static instance: SecretsManager;
  private secretsCache = new Map<string, string>();
  private readonly secretsPath = '/tmp/secrets';

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SecretsManager {
    if (!SecretsManager.instance) {
      SecretsManager.instance = new SecretsManager();
    }
    return SecretsManager.instance;
  }

  /**
   * Read secret from environment variable or file
   * Follows the pattern: process.env.VAR || cat /tmp/secrets/VAR
   */
  getSecret(secretName: string, fallbackValue?: string): string {
    // Check cache first
    if (this.secretsCache.has(secretName)) {
      return this.secretsCache.get(secretName)!;
    }

    // Try environment variable first
    const envValue = process.env[secretName];
    if (envValue && envValue.trim() !== '') {
      this.secretsCache.set(secretName, envValue);
      logger.debug(`Secret ${secretName} loaded from environment variable`);
      return envValue;
    }

    // Try reading from secrets file
    const secretFilePath = `${this.secretsPath}/${secretName}`;
    if (existsSync(secretFilePath)) {
      try {
        const fileValue = readFileSync(secretFilePath, 'utf-8').trim();
        this.secretsCache.set(secretName, fileValue);
        logger.debug(`Secret ${secretName} loaded from file: ${secretFilePath}`);
        return fileValue;
      } catch (error) {
        logger.warn(`Failed to read secret from file ${secretFilePath}: ${error}`);
      }
    }

    // Use fallback value if provided
    if (fallbackValue !== undefined) {
      logger.warn(`Using fallback value for secret: ${secretName}`);
      this.secretsCache.set(secretName, fallbackValue);
      return fallbackValue;
    }

    // Throw error if no secret found and no fallback
    throw new Error(
      `Secret ${secretName} not found in environment variable or file ${secretFilePath}`
    );
  }

  /**
   * Get secret encoded in base64
   * Used for Kubernetes secrets that need base64 encoding
   */
  getSecretEncoded(secretName: string, fallbackValue?: string): string {
    const secret = this.getSecret(secretName, fallbackValue);
    return Buffer.from(secret).toString('base64').replace(/\n/g, '');
  }

  /**
   * Get database configuration following the RDS pattern
   */
  getDatabaseConfig(): DatabaseSecretsConfig {
    return {
      user: this.getSecret('RDS_USER', 'postgres'),
      password: this.getSecret('RDS_PASSWORD'),
      host: this.getSecret('RDS_1_HOST', 'localhost'),
      port: parseInt(this.getSecret('RDS_PORT', '5432'), 10),
      database: this.getSecret('POSTGRES_DATABASE', 'backstage'),
    };
  }

  /**
   * Get PostgreSQL connection string
   */
  getPostgresConnectionString(): string {
    const config = this.getDatabaseConfig();
    return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
  }

  /**
   * Get GitHub authentication configuration
   */
  getGitHubConfig(): GitHubSecretsConfig {
    return {
      appId: this.getSecret('GITHUB_APP_APP_ID'),
      clientId: this.getSecret('GITHUB_APP_CLIENT_ID'),
      clientSecret: this.getSecret('GITHUB_APP_CLIENT_SECRET'),
      privateKey: this.getSecret('GITHUB_APP_PRIVATE_KEY'),
      webhookSecret: this.getSecret('GITHUB_APP_WEBHOOK_SECRET'),
      orgName: this.getSecret('GITHUB_ORG', 'janus-qe'),
    };
  }

  /**
   * Get Keycloak authentication configuration
   */
  getKeycloakConfig(): KeycloakSecretsConfig {
    return {
      baseUrl: this.getSecret('KEYCLOAK_BASE_URL'),
      realm: this.getSecret('KEYCLOAK_REALM', 'myrealm'),
      clientId: this.getSecret('KEYCLOAK_CLIENT_ID', 'myclient'),
      clientSecret: this.getSecret('KEYCLOAK_CLIENT_SECRET'),
    };
  }

  /**
   * Get Redis configuration
   */
  getRedisConfig(): RedisSecretsConfig {
    return {
      username: this.getSecret('REDIS_USERNAME', 'temp'),
      password: this.getSecret('REDIS_PASSWORD', 'test123'),
      host: this.getSecret('REDIS_HOST', 'redis'),
      port: parseInt(this.getSecret('REDIS_PORT', '6379'), 10),
    };
  }

  /**
   * Get cluster authentication configuration
   */
  getClusterConfig(): ClusterSecretsConfig {
    return {
      url: this.getSecret('K8S_CLUSTER_URL'),
      token: this.getSecret('K8S_CLUSTER_TOKEN'),
      routerBase: this.getSecret('K8S_CLUSTER_ROUTER_BASE', 'localhost'),
    };
  }

  /**
   * Get all environment variables that should be base64 encoded for Kubernetes secrets
   * Following the pattern from secrets-rhdh-secrets.yaml
   */
  getKubernetesSecrets(): Record<string, string> {
    const secrets: Record<string, string> = {};

    // GitHub configuration
    const githubConfig = this.getGitHubConfig();
    secrets.GITHUB_APP_APP_ID = this.getSecretEncoded('GITHUB_APP_APP_ID');
    secrets.GITHUB_APP_CLIENT_ID = this.getSecretEncoded('GITHUB_APP_CLIENT_ID');
    secrets.GITHUB_APP_PRIVATE_KEY = this.getSecretEncoded('GITHUB_APP_PRIVATE_KEY');
    secrets.GITHUB_APP_CLIENT_SECRET = this.getSecretEncoded('GITHUB_APP_CLIENT_SECRET');

    // Keycloak configuration
    secrets.KEYCLOAK_BASE_URL = this.getSecretEncoded('KEYCLOAK_BASE_URL');
    secrets.KEYCLOAK_REALM = this.getSecretEncoded('KEYCLOAK_REALM', 'myrealm');
    secrets.KEYCLOAK_CLIENT_ID = this.getSecretEncoded('KEYCLOAK_CLIENT_ID', 'myclient');
    secrets.KEYCLOAK_CLIENT_SECRET = this.getSecretEncoded('KEYCLOAK_CLIENT_SECRET');

    // Database configuration
    const dbConfig = this.getDatabaseConfig();
    secrets.POSTGRES_USER = Buffer.from(dbConfig.user).toString('base64');
    secrets.POSTGRES_PASSWORD = Buffer.from(dbConfig.password).toString('base64');
    secrets.POSTGRES_HOST = Buffer.from(dbConfig.host).toString('base64');

    // Cluster configuration
    const clusterConfig = this.getClusterConfig();
    secrets.K8S_CLUSTER_TOKEN_ENCODED = this.getSecretEncoded('K8S_CLUSTER_TOKEN');
    secrets.K8S_CLUSTER_API_SERVER_URL = this.getSecretEncoded('K8S_CLUSTER_URL');

    // Redis configuration
    const redisConfig = this.getRedisConfig();
    secrets.REDIS_USERNAME_ENCODED = Buffer.from(redisConfig.username).toString('base64');
    secrets.REDIS_PASSWORD_ENCODED = Buffer.from(redisConfig.password).toString('base64');

    return secrets;
  }

  /**
   * Clear secrets cache
   */
  clearCache(): void {
    this.secretsCache.clear();
    logger.debug('Secrets cache cleared');
  }
}

/**
 * Type definitions for secret configurations
 */
export interface DatabaseSecretsConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export interface GitHubSecretsConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
  orgName: string;
}

export interface KeycloakSecretsConfig {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}

export interface RedisSecretsConfig {
  username: string;
  password: string;
  host: string;
  port: number;
}

export interface ClusterSecretsConfig {
  url: string;
  token: string;
  routerBase: string;
}

/**
 * Convenience function to get the secrets manager instance
 */
export const getSecretsManager = (): SecretsManager => SecretsManager.getInstance();
