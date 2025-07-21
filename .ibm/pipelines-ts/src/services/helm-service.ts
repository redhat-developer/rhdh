import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { helm } from '../utils/shell.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const helmLogger = createLogger({ component: 'helm' });

/**
 * Helm configuration schema
 */
export const HelmConfigSchema = z.object({
  chart_path: z.string().min(1),
  release_name: z.string().min(1),
  namespace: z.string().min(1),
  values: z.record(z.any()).optional(),
  values_files: z.array(z.string()).optional(),
  wait_for_deployment: z.boolean().default(true),
  timeout_seconds: z.number().default(600),
  atomic: z.boolean().default(true),
  cleanup_on_fail: z.boolean().default(true),
  force: z.boolean().default(false),
  recreate_pods: z.boolean().default(false),
});

export type HelmConfig = z.infer<typeof HelmConfigSchema>;

/**
 * Helm deployment result schema
 */
export const HelmResultSchema = z.object({
  release_name: z.string(),
  namespace: z.string(),
  chart: z.string(),
  status: z.string(),
  revision: z.number(),
  deployed_at: z.string(),
  release_info: z.record(z.any()),
  values_used: z.record(z.any()).optional(),
});

export type HelmResult = z.infer<typeof HelmResultSchema>;

/**
 * Helm Service
 *
 * This service provides comprehensive Helm chart management capabilities,
 * replacing manual dependency installation with automated Helm subcharts.
 *
 * Benefits:
 * - Automated dependency management (PostgreSQL, Redis, etc.)
 * - Version pinning and rollback capabilities
 * - Atomic deployments with automatic rollback on failure
 * - Parallel installation of dependencies
 * - Built-in health checks and wait conditions
 */
export class HelmService {
  private readonly logger = helmLogger;
  private readonly artifactDir = '/tmp/helm-artifacts';

  constructor() {
    // Ensure artifact directory exists
    mkdirSync(this.artifactDir, { recursive: true });
  }

  /**
   * Deploy a Helm chart
   */
  async deployChart(config: HelmConfig): Promise<HelmResult> {
    const validatedConfig = HelmConfigSchema.parse(config);
    this.logger.info(`📦 Deploying Helm chart: ${validatedConfig.chart_path}`);

    try {
      // Update dependencies first
      await this.updateDependencies(validatedConfig.chart_path);

      // Prepare values file if custom values provided
      let valuesFile: string | undefined;
      if (validatedConfig.values) {
        valuesFile = await this.createValuesFile(validatedConfig);
      }

      // Build Helm command
      const helmArgs = this.buildHelmArgs(validatedConfig, valuesFile);

      // Execute Helm upgrade/install
      const result = await helm(helmArgs);

      if (!result.success) {
        throw new Error(`Helm deployment failed: ${result.stderr}`);
      }

      // Get release info
      const releaseInfo = await this.getReleaseInfo(
        validatedConfig.release_name,
        validatedConfig.namespace
      );

      this.logger.info(`✅ Helm deployment completed successfully`);

      return {
        release_name: validatedConfig.release_name,
        namespace: validatedConfig.namespace,
        chart: validatedConfig.chart_path,
        status: 'deployed',
        revision: releaseInfo.revision || 1,
        deployed_at: new Date().toISOString(),
        release_info: releaseInfo,
        values_used: validatedConfig.values,
      };
    } catch (error) {
      this.logger.error(`❌ Helm deployment failed:`, error);
      throw error;
    }
  }

  /**
   * Update Helm chart dependencies
   */
  private async updateDependencies(chartPath: string): Promise<void> {
    this.logger.info(`📥 Updating Helm dependencies for ${chartPath}`);

    const result = await helm(['dependency', 'update', chartPath]);

    if (!result.success) {
      this.logger.warn(`Dependency update failed: ${result.stderr}`);
      // Don't fail deployment if dependency update fails
      // Chart might not have dependencies
    } else {
      this.logger.info('✅ Dependencies updated successfully');
    }
  }

  /**
   * Create temporary values file
   */
  private async createValuesFile(config: HelmConfig): Promise<string> {
    const valuesFile = join(this.artifactDir, `${config.release_name}-values.yaml`);
    const yamlContent = yaml.dump(config.values);

    writeFileSync(valuesFile, yamlContent);
    this.logger.info(`📝 Created values file: ${valuesFile}`);

    return valuesFile;
  }

  /**
   * Build Helm command arguments
   */
  private buildHelmArgs(config: HelmConfig, valuesFile?: string): string[] {
    const args = [
      'upgrade',
      '--install',
      config.release_name,
      config.chart_path,
      '--namespace',
      config.namespace,
      '--create-namespace',
    ];

    // Add values files
    if (valuesFile) {
      args.push('--values', valuesFile);
    }

    if (config.values_files) {
      for (const file of config.values_files) {
        args.push('--values', file);
      }
    }

    // Add flags
    if (config.wait_for_deployment) {
      args.push('--wait');
    }

    if (config.timeout_seconds) {
      args.push('--timeout', `${config.timeout_seconds}s`);
    }

    if (config.atomic) {
      args.push('--atomic');
    }

    if (config.cleanup_on_fail) {
      args.push('--cleanup-on-fail');
    }

    if (config.force) {
      args.push('--force');
    }

    if (config.recreate_pods) {
      args.push('--recreate-pods');
    }

    return args;
  }

  /**
   * Get release information
   */
  private async getReleaseInfo(releaseName: string, namespace: string): Promise<any> {
    try {
      const result = await helm([
        'get',
        'values',
        releaseName,
        '--namespace',
        namespace,
        '--output',
        'json',
      ]);

      if (result.success) {
        return JSON.parse(result.stdout);
      }
    } catch (error) {
      this.logger.warn('Failed to get release info:', error);
    }

    return {};
  }

  /**
   * Uninstall a Helm release
   */
  async uninstallRelease(options: {
    release_name: string;
    namespace: string;
    wait?: boolean;
    timeout?: number;
  }): Promise<void> {
    this.logger.info(`🗑️ Uninstalling Helm release: ${options.release_name}`);

    const args = ['uninstall', options.release_name, '--namespace', options.namespace];

    if (options.wait) {
      args.push('--wait');
    }

    if (options.timeout) {
      args.push('--timeout', `${options.timeout}s`);
    }

    const result = await helm(args);

    if (!result.success) {
      throw new Error(`Failed to uninstall release: ${result.stderr}`);
    }

    this.logger.info('✅ Release uninstalled successfully');
  }

  /**
   * Rollback a Helm release
   */
  async rollbackRelease(options: {
    release_name: string;
    namespace: string;
    revision?: number;
    wait?: boolean;
    timeout?: number;
  }): Promise<void> {
    this.logger.info(`⏪ Rolling back Helm release: ${options.release_name}`);

    const args = ['rollback', options.release_name];

    if (options.revision) {
      args.push(String(options.revision));
    }

    args.push('--namespace', options.namespace);

    if (options.wait) {
      args.push('--wait');
    }

    if (options.timeout) {
      args.push('--timeout', `${options.timeout}s`);
    }

    const result = await helm(args);

    if (!result.success) {
      throw new Error(`Failed to rollback release: ${result.stderr}`);
    }

    this.logger.info('✅ Release rolled back successfully');
  }

  /**
   * List Helm releases
   */
  async listReleases(namespace?: string): Promise<any[]> {
    const args = ['list', '--output', 'json'];

    if (namespace) {
      args.push('--namespace', namespace);
    } else {
      args.push('--all-namespaces');
    }

    const result = await helm(args);

    if (!result.success) {
      throw new Error(`Failed to list releases: ${result.stderr}`);
    }

    try {
      return JSON.parse(result.stdout);
    } catch {
      return [];
    }
  }

  /**
   * Get Helm release status
   */
  async getReleaseStatus(releaseName: string, namespace: string): Promise<string> {
    const result = await helm([
      'status',
      releaseName,
      '--namespace',
      namespace,
      '--output',
      'json',
    ]);

    if (!result.success) {
      throw new Error(`Failed to get release status: ${result.stderr}`);
    }

    try {
      const status = JSON.parse(result.stdout);
      return status.info?.status || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Validate Helm setup
   */
  async validateHelmSetup(): Promise<boolean> {
    try {
      // Check if Helm is installed
      const versionResult = await helm(['version', '--short']);

      if (!versionResult.success) {
        this.logger.error('Helm is not installed or not in PATH');
        return false;
      }

      this.logger.info(`Helm version: ${versionResult.stdout.trim()}`);

      // Check if we can list repositories
      const repoResult = await helm(['repo', 'list']);

      if (!repoResult.success) {
        this.logger.warn('No Helm repositories configured');
      }

      return true;
    } catch (error) {
      this.logger.error('Helm validation failed:', error);
      return false;
    }
  }

  /**
   * Add Helm repository
   */
  async addRepository(
    name: string,
    url: string,
    options?: {
      username?: string;
      password?: string;
      force_update?: boolean;
    }
  ): Promise<void> {
    this.logger.info(`📦 Adding Helm repository: ${name} -> ${url}`);

    const args = ['repo', 'add', name, url];

    if (options?.username) {
      args.push('--username', options.username);
    }

    if (options?.password) {
      args.push('--password', options.password);
    }

    if (options?.force_update) {
      args.push('--force-update');
    }

    const result = await helm(args);

    if (!result.success) {
      throw new Error(`Failed to add repository: ${result.stderr}`);
    }

    // Update repository index
    await this.updateRepositories();

    this.logger.info('✅ Repository added successfully');
  }

  /**
   * Update Helm repositories
   */
  async updateRepositories(): Promise<void> {
    this.logger.info('📥 Updating Helm repositories');

    const result = await helm(['repo', 'update']);

    if (!result.success) {
      throw new Error(`Failed to update repositories: ${result.stderr}`);
    }

    this.logger.info('✅ Repositories updated successfully');
  }

  /**
   * Template a Helm chart (dry-run)
   */
  async templateChart(config: HelmConfig): Promise<string> {
    const validatedConfig = HelmConfigSchema.parse(config);

    const args = [
      'template',
      validatedConfig.release_name,
      validatedConfig.chart_path,
      '--namespace',
      validatedConfig.namespace,
    ];

    if (validatedConfig.values) {
      const valuesFile = await this.createValuesFile(validatedConfig);
      args.push('--values', valuesFile);
    }

    const result = await helm(args);

    if (!result.success) {
      throw new Error(`Failed to template chart: ${result.stderr}`);
    }

    return result.stdout;
  }
}
