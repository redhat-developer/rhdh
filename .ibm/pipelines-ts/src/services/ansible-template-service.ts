import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { executeCommand } from '../utils/shell.js';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ansibleLogger = createLogger({ component: 'ansible' });

/**
 * Ansible configuration schema
 */
export const AnsibleConfigSchema = z.object({
  cluster_type: z.enum(['openshift', 'aks', 'gke']),
  namespace: z.string().min(1),
  router_base: z.string().min(1),
  image_repository: z.string().min(1),
  image_tag: z.string().min(1),
  enable_rbac: z.boolean().default(false),
  enable_postgresql: z.boolean().default(true),
  enable_redis: z.boolean().default(true),
  enable_monitoring: z.boolean().default(false),
  enable_github_auth: z.boolean().default(false),
  enable_kubernetes_plugin: z.boolean().default(true),
  secrets: z
    .object({
      backend_secret: z.string().optional(),
      postgresql_password: z.string().optional(),
      github_client_id: z.string().optional(),
      github_client_secret: z.string().optional(),
      k8s_cluster_token: z.string().optional(),
    })
    .optional(),
  custom_values: z.record(z.any()).optional(),
});

export type AnsibleConfig = z.infer<typeof AnsibleConfigSchema>;

/**
 * Ansible result schema
 */
export const AnsibleResultSchema = z.object({
  success: z.boolean(),
  output_directory: z.string(),
  generated_files: z.array(z.string()),
  cluster_type: z.string(),
  execution_time: z.number(),
});

export type AnsibleResult = z.infer<typeof AnsibleResultSchema>;

/**
 * Ansible Template Service
 *
 * This service handles dynamic configuration generation using Ansible templates,
 * replacing all manual YAML merging with intelligent Jinja2 templating.
 *
 * Benefits:
 * - Dynamic configuration based on cluster type
 * - Eliminates 9 separate values files into 1 template
 * - Conditional logic for cluster-specific features
 * - Type-safe configuration with Zod validation
 * - Centralized secret management
 */
export class AnsibleTemplateService {
  private readonly logger = ansibleLogger;
  private readonly playbookPath =
    '.ibm/pipelines-ts/infrastructure/ansible/playbooks/generate-configs.yml';

  private readonly outputBaseDir = '/tmp/rhdh-configs';

  constructor() {
    // Ensure output directory exists
    mkdirSync(this.outputBaseDir, { recursive: true });
  }

  /**
   * Generate configurations using Ansible templates
   */
  async generateConfigurations(config: AnsibleConfig): Promise<AnsibleResult> {
    const validatedConfig = AnsibleConfigSchema.parse(config);
    const startTime = Date.now();

    this.logger.info(
      `🎭 Generating configurations with Ansible for ${validatedConfig.cluster_type}`
    );

    try {
      // Create output directory for this run
      const outputDir = join(this.outputBaseDir, `${Date.now()}`);
      mkdirSync(outputDir, { recursive: true });

      // Build Ansible extra vars
      const extraVars = this.buildExtraVars(validatedConfig, outputDir);

      // Execute Ansible playbook
      const result = await this.runAnsiblePlaybook(extraVars);

      if (!result.success) {
        throw new Error(`Ansible playbook execution failed: ${result.stderr}`);
      }

      // Get list of generated files
      const generatedFiles = await this.getGeneratedFiles(outputDir, validatedConfig.cluster_type);

      this.logger.info(`✅ Ansible configuration generation completed`);
      this.logger.info(`📁 Generated ${generatedFiles.length} files in ${outputDir}`);

      return {
        success: true,
        output_directory: outputDir,
        generated_files: generatedFiles,
        cluster_type: validatedConfig.cluster_type,
        execution_time: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`❌ Ansible configuration generation failed:`, error);
      throw error;
    }
  }

  /**
   * Build extra vars for Ansible playbook
   */
  private buildExtraVars(config: AnsibleConfig, outputDir: string): Record<string, any> {
    const extraVars: Record<string, any> = {
      // Basic configuration
      target_namespace: config.namespace,
      target_cluster_type: config.cluster_type,
      target_router_base: config.router_base,
      ansible_output_dir: outputDir,

      // Image configuration
      image_repository: config.image_repository,
      image_tag: config.image_tag,

      // Feature flags
      enable_rbac: config.enable_rbac,
      enable_postgresql: config.enable_postgresql,
      enable_redis: config.enable_redis,
      enable_monitoring: config.enable_monitoring,
      enable_github_auth: config.enable_github_auth,
      enable_kubernetes_plugin: config.enable_kubernetes_plugin,
    };

    // Add secrets if provided
    if (config.secrets) {
      extraVars.backend_secret = config.secrets.backend_secret || 'change-me-secret';
      extraVars.postgresql_password = config.secrets.postgresql_password || 'postgres';
      extraVars.github_client_id = config.secrets.github_client_id || '';
      extraVars.github_client_secret = config.secrets.github_client_secret || '';
      extraVars.k8s_cluster_token = config.secrets.k8s_cluster_token || '';
    }

    // Add cluster-specific variables
    switch (config.cluster_type) {
      case 'gke':
        extraVars.gke_cert_name = process.env.GKE_CERT_NAME || 'rhdh-cert';
        extraVars.gke_static_ip = process.env.GKE_STATIC_IP || 'rhdh-ip';
        extraVars.gke_cluster_name = process.env.GKE_CLUSTER_NAME || 'gke-cluster';
        break;
      case 'aks':
        extraVars.aks_cluster_name = process.env.AKS_CLUSTER_NAME || 'aks-cluster';
        extraVars.aks_resource_group = process.env.AKS_RESOURCE_GROUP || 'rhdh-rg';
        break;
      case 'openshift':
        extraVars.openshift_cluster_name =
          process.env.OPENSHIFT_CLUSTER_NAME || 'openshift-cluster';
        break;
    }

    // Add custom values if provided
    if (config.custom_values) {
      Object.assign(extraVars, config.custom_values);
    }

    return extraVars;
  }

  /**
   * Run Ansible playbook
   */
  private async runAnsiblePlaybook(extraVars: Record<string, any>): Promise<any> {
    // Build ansible-playbook command
    const args = ['-i', 'localhost,', this.playbookPath, '--extra-vars', JSON.stringify(extraVars)];

    // Add verbosity for debugging
    if (process.env.ANSIBLE_VERBOSE === 'true') {
      args.push('-vvv');
    }

    this.logger.info('🎬 Executing Ansible playbook...');

    const result = await executeCommand('ansible-playbook', args, {
      cwd: process.cwd(),
      throwOnError: false,
      logOutput: true,
    });

    return result;
  }

  /**
   * Get list of generated files
   */
  private async getGeneratedFiles(outputDir: string, clusterType: string): Promise<string[]> {
    const clusterDir = join(outputDir, clusterType);

    if (!existsSync(clusterDir)) {
      return [];
    }

    const result = await executeCommand('find', [clusterDir, '-type', 'f'], {
      throwOnError: false,
    });

    if (!result.success) {
      return [];
    }

    return result.stdout
      .split('\n')
      .filter((file) => file.trim() !== '')
      .map((file) => file.replace(outputDir + '/', ''));
  }

  /**
   * Apply generated configurations
   */
  async applyConfigurations(outputDir: string, namespace: string): Promise<void> {
    this.logger.info(`📦 Applying generated configurations from ${outputDir}`);

    const configFiles = ['secrets.yaml', 'configmap.yaml'];

    for (const file of configFiles) {
      const filePath = join(outputDir, file);

      if (existsSync(filePath)) {
        this.logger.info(`Applying ${file}...`);

        const result = await executeCommand('kubectl', ['apply', '-f', filePath, '-n', namespace], {
          throwOnError: false,
        });

        if (!result.success) {
          this.logger.warn(`Failed to apply ${file}: ${result.stderr}`);
        }
      }
    }

    this.logger.info('✅ Configuration application completed');
  }

  /**
   * Validate Ansible setup
   */
  async validateAnsibleSetup(): Promise<boolean> {
    try {
      // Check if Ansible is installed
      const versionResult = await executeCommand('ansible', ['--version'], {
        throwOnError: false,
      });

      if (!versionResult.success) {
        this.logger.error('Ansible is not installed or not in PATH');
        return false;
      }

      this.logger.info(`Ansible version: ${versionResult.stdout.split('\n')[0]}`);

      // Check if playbook exists
      if (!existsSync(this.playbookPath)) {
        this.logger.error(`Ansible playbook not found: ${this.playbookPath}`);
        return false;
      }

      // Check if required roles/collections are installed
      const galaxyResult = await executeCommand('ansible-galaxy', ['collection', 'list'], {
        throwOnError: false,
      });

      if (!galaxyResult.success) {
        this.logger.warn('Failed to list Ansible collections');
      }

      return true;
    } catch (error) {
      this.logger.error('Ansible validation failed:', error);
      return false;
    }
  }

  /**
   * Install Ansible requirements
   */
  async installRequirements(): Promise<void> {
    this.logger.info('📦 Installing Ansible requirements');

    const requirementsFile = '.ibm/pipelines-ts/infrastructure/ansible/requirements.yml';

    if (existsSync(requirementsFile)) {
      const result = await executeCommand('ansible-galaxy', ['install', '-r', requirementsFile], {
        throwOnError: false,
      });

      if (!result.success) {
        this.logger.warn(`Failed to install Ansible requirements: ${result.stderr}`);
      }
    }

    this.logger.info('✅ Ansible requirements installation completed');
  }

  /**
   * Get template preview
   */
  async getTemplatePreview(config: AnsibleConfig): Promise<string> {
    const validatedConfig = AnsibleConfigSchema.parse(config);

    // Run ansible with check mode to preview
    const extraVars = this.buildExtraVars(validatedConfig, '/tmp/preview');

    const args = [
      '-i',
      'localhost,',
      this.playbookPath,
      '--extra-vars',
      JSON.stringify(extraVars),
      '--check',
      '--diff',
    ];

    const result = await executeCommand('ansible-playbook', args, {
      throwOnError: false,
    });

    return result.stdout;
  }
}
