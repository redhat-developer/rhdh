import { SecretsManager } from '../secrets-manager.js';
import { existsSync, readFileSync } from 'fs';
import { jest } from '@jest/globals';

// Mock filesystem functions
jest.mock('fs');
const mockExistsSync = jest.mocked(existsSync);
const mockReadFileSync = jest.mocked(readFileSync);

describe('SecretsManager', () => {
  let secretsManager: SecretsManager;

  beforeEach(() => {
    // Clear singleton instance
    (SecretsManager as any).instance = null;
    secretsManager = SecretsManager.getInstance();

    // Clear cache
    secretsManager.clearCache();

    // Clear environment variables
    delete process.env.TEST_SECRET;
    delete process.env.RDS_PASSWORD;
    delete process.env.K8S_CLUSTER_TOKEN;

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = SecretsManager.getInstance();
      const instance2 = SecretsManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('getSecret', () => {
    it('should return value from environment variable first', () => {
      process.env.TEST_SECRET = 'env-value';
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file-value');

      const result = secretsManager.getSecret('TEST_SECRET');

      expect(result).toBe('env-value');
      expect(mockExistsSync).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('should read from file when env var is not set', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file-value\n');

      const result = secretsManager.getSecret('TEST_SECRET');

      expect(result).toBe('file-value');
      expect(mockExistsSync).toHaveBeenCalledWith('/tmp/secrets/TEST_SECRET');
      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/secrets/TEST_SECRET', 'utf-8');
    });

    it('should use fallback value when neither env var nor file exists', () => {
      mockExistsSync.mockReturnValue(false);

      const result = secretsManager.getSecret('TEST_SECRET', 'fallback-value');

      expect(result).toBe('fallback-value');
    });

    it('should throw error when no secret found and no fallback', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => secretsManager.getSecret('TEST_SECRET')).toThrow(
        'Secret TEST_SECRET not found in environment variable or file /tmp/secrets/TEST_SECRET'
      );
    });

    it('should cache secrets after first read', () => {
      process.env.TEST_SECRET = 'cached-value';

      // First call
      const result1 = secretsManager.getSecret('TEST_SECRET');

      // Clear env var
      delete process.env.TEST_SECRET;

      // Second call should return cached value
      const result2 = secretsManager.getSecret('TEST_SECRET');

      expect(result1).toBe('cached-value');
      expect(result2).toBe('cached-value');
    });
  });

  describe('getSecretEncoded', () => {
    it('should return base64 encoded secret', () => {
      process.env.TEST_SECRET = 'test-value';

      const result = secretsManager.getSecretEncoded('TEST_SECRET');
      const expected = Buffer.from('test-value').toString('base64');

      expect(result).toBe(expected);
    });

    it('should remove newlines from base64 encoded value', () => {
      const multilineSecret = 'line1\nline2\nline3';
      process.env.TEST_SECRET = multilineSecret;

      const result = secretsManager.getSecretEncoded('TEST_SECRET');

      expect(result).not.toContain('\n');
      expect(result).toBe(Buffer.from(multilineSecret).toString('base64'));
    });
  });

  describe('getDatabaseConfig', () => {
    it('should return database configuration from secrets', () => {
      process.env.RDS_USER = 'test-user';
      process.env.RDS_PASSWORD = 'test-password';
      process.env.RDS_1_HOST = 'test-host';
      process.env.RDS_PORT = '5433';
      process.env.POSTGRES_DATABASE = 'test-db';

      const config = secretsManager.getDatabaseConfig();

      expect(config).toEqual({
        user: 'test-user',
        password: 'test-password',
        host: 'test-host',
        port: 5433,
        database: 'test-db',
      });
    });

    it('should use default values when secrets are not set', () => {
      // Set only password to avoid error
      process.env.RDS_PASSWORD = 'test-password';

      const config = secretsManager.getDatabaseConfig();

      expect(config).toEqual({
        user: 'postgres',
        password: 'test-password',
        host: 'localhost',
        port: 5432,
        database: 'backstage',
      });
    });
  });

  describe('getGitHubConfig', () => {
    it('should return GitHub configuration from secrets', () => {
      process.env.GITHUB_APP_APP_ID = '123456';
      process.env.GITHUB_APP_CLIENT_ID = 'test-client-id';
      process.env.GITHUB_APP_CLIENT_SECRET = 'test-secret';
      process.env.GITHUB_APP_PRIVATE_KEY = 'test-key';
      process.env.GITHUB_APP_WEBHOOK_SECRET = 'webhook-secret';
      process.env.GITHUB_ORG = 'test-org';

      const config = secretsManager.getGitHubConfig();

      expect(config).toEqual({
        appId: '123456',
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        privateKey: 'test-key',
        webhookSecret: 'webhook-secret',
        orgName: 'test-org',
      });
    });
  });

  describe('getKeycloakConfig', () => {
    it('should return Keycloak configuration from secrets', () => {
      process.env.KEYCLOAK_BASE_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'test-realm';
      process.env.KEYCLOAK_CLIENT_ID = 'test-client';
      process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret';

      const config = secretsManager.getKeycloakConfig();

      expect(config).toEqual({
        baseUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });
    });

    it('should use default values for optional fields', () => {
      process.env.KEYCLOAK_BASE_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret';

      const config = secretsManager.getKeycloakConfig();

      expect(config).toEqual({
        baseUrl: 'https://keycloak.example.com',
        realm: 'myrealm',
        clientId: 'myclient',
        clientSecret: 'test-secret',
      });
    });
  });

  describe('getKubernetesSecrets', () => {
    it('should return all secrets base64 encoded for Kubernetes', () => {
      // Set up minimal required secrets
      process.env.RDS_PASSWORD = 'db-password';
      process.env.K8S_CLUSTER_TOKEN = 'cluster-token';
      process.env.K8S_CLUSTER_URL = 'https://api.cluster.com';
      process.env.GITHUB_APP_APP_ID = '123';
      process.env.GITHUB_APP_CLIENT_ID = 'client-id';
      process.env.GITHUB_APP_PRIVATE_KEY = 'private-key';
      process.env.GITHUB_APP_CLIENT_SECRET = 'client-secret';
      process.env.KEYCLOAK_BASE_URL = 'https://keycloak.com';
      process.env.KEYCLOAK_CLIENT_SECRET = 'kc-secret';

      const secrets = secretsManager.getKubernetesSecrets();

      expect(secrets).toHaveProperty('POSTGRES_PASSWORD');
      expect(secrets).toHaveProperty('K8S_CLUSTER_TOKEN_ENCODED');
      expect(secrets).toHaveProperty('GITHUB_APP_CLIENT_SECRET');
      expect(secrets).toHaveProperty('KEYCLOAK_CLIENT_SECRET');

      // Verify base64 encoding
      expect(secrets.POSTGRES_PASSWORD).toBe(Buffer.from('db-password').toString('base64'));
      expect(secrets.K8S_CLUSTER_TOKEN_ENCODED).toBe(
        Buffer.from('cluster-token').toString('base64')
      );
    });
  });

  describe('clearCache', () => {
    it('should clear the secrets cache', () => {
      process.env.TEST_SECRET = 'cached-value';

      // Load into cache
      secretsManager.getSecret('TEST_SECRET');

      // Clear environment and cache
      delete process.env.TEST_SECRET;
      secretsManager.clearCache();

      // Should now fail since not in cache or env
      mockExistsSync.mockReturnValue(false);

      expect(() => secretsManager.getSecret('TEST_SECRET')).toThrow('Secret TEST_SECRET not found');
    });
  });

  describe('error handling', () => {
    it('should handle file read errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => secretsManager.getSecret('TEST_SECRET')).toThrow(
        'Secret TEST_SECRET not found in environment variable or file /tmp/secrets/TEST_SECRET'
      );
    });
  });
});
