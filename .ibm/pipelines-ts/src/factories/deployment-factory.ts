import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { AnsibleTemplateService } from '../services/ansible-template-service.js';
import { KustomizeService } from '../services/kustomize-service.js';
import { HelmService } from '../services/helm-service.js';

const logger = createLogger({ component: 'deployment-factory' });

/**
 * Deployment strategy types
 */
export type DeploymentStrategy = 'ansible' | 'kustomize' | 'helm' | 'hybrid';

/**
 * Deployment configuration schema
 */
export const DeploymentConfigSchema = z.object({
  strategy: z.enum(['ansible', 'kustomize', 'helm', 'hybrid']),
  namespace: z.string().min(1),
  clusterType: z.enum(['openshift', 'aks', 'gke']),
  routerBase: z.string().min(1),
  enableRbac: z.boolean().default(false),
  enableMonitoring: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

/**
 * Deployment Factory
 *
 * This factory centralizes the deployment strategy selection and provides
 * recommendations based on the use case and environment.
 *
 * Strategy Selection Guide:
 * - ansible: Best for complex configurations, multi-environment setups
 * - kustomize: Best for GitOps, declarative management, CI/CD pipelines
 * - helm: Best for dependency management, versioning, rollbacks
 * - hybrid: Combines multiple strategies for maximum flexibility
 */
export class DeploymentFactory {
  private readonly ansibleService: AnsibleTemplateService;
  private readonly kustomizeService: KustomizeService;
  private readonly helmService: HelmService;

  constructor(private readonly config: Record<string, any>) {
    this.ansibleService = new AnsibleTemplateService();
    this.kustomizeService = new KustomizeService();
    this.helmService = new HelmService();
  }

  /**
   * Get recommended deployment strategy based on context
   */
  static getRecommendedStrategy(context: {
    environment: 'development' | 'staging' | 'production';
    gitOpsEnabled: boolean;
    complexConfiguration: boolean;
    hasDependencies: boolean;
    requiresRollback: boolean;
  }): DeploymentStrategy {
    // Production with GitOps
    if (context.environment === 'production' && context.gitOpsEnabled) {
      return 'kustomize';
    }

    // Complex configurations
    if (context.complexConfiguration) {
      return 'ansible';
    }

    // Dependencies and rollback requirements
    if (context.hasDependencies && context.requiresRollback) {
      return 'helm';
    }

    // Development environments
    if (context.environment === 'development') {
      return 'ansible'; // Flexibility for development
    }

    // Default to hybrid for maximum flexibility
    return 'hybrid';
  }

  /**
   * Create deployment based on strategy
   */
  async deploy(config: DeploymentConfig): Promise<any> {
    const validatedConfig = DeploymentConfigSchema.parse(config);

    logger.info(`🏭 Deploying with strategy: ${validatedConfig.strategy}`);

    switch (validatedConfig.strategy) {
      case 'ansible':
        return this.deployWithAnsible(validatedConfig);

      case 'kustomize':
        return this.deployWithKustomize(validatedConfig);

      case 'helm':
        return this.deployWithHelm(validatedConfig);

      case 'hybrid':
        return this.deployWithHybrid(validatedConfig);

      default:
        throw new Error(`Unknown deployment strategy: ${validatedConfig.strategy}`);
    }
  }

  /**
   * Deploy using Ansible strategy
   */
  private async deployWithAnsible(config: DeploymentConfig): Promise<any> {
    logger.info('🎭 Using Ansible deployment strategy');

    // Generate configurations
    const ansibleResult = await this.ansibleService.generateConfigurations({
      cluster_type: config.clusterType,
      namespace: config.namespace,
      router_base: config.routerBase,
      image_repository: this.config.QUAY_REPO,
      image_tag: this.getImageTag(),
      enable_rbac: config.enableRbac,
      enable_monitoring: config.enableMonitoring,
      enable_postgresql: true,
      enable_redis: true,
      enable_github_auth: false,
      enable_kubernetes_plugin: true,
    });

    if (!config.dryRun) {
      // Apply configurations
      await this.ansibleService.applyConfigurations(
        ansibleResult.output_directory,
        config.namespace
      );
    }

    return ansibleResult;
  }

  /**
   * Deploy using Kustomize strategy
   */
  private async deployWithKustomize(config: DeploymentConfig): Promise<any> {
    logger.info('🧩 Using Kustomize deployment strategy');

    return this.kustomizeService.applyOverlay({
      cluster_type: config.clusterType,
      namespace: config.namespace,
      router_base: config.routerBase,
      image_tag: this.getImageTag(),
      dry_run: config.dryRun,
      wait_for_deployment: true,
      prune: false,
      force_conflicts: false,
      server_side_apply: true,
    });
  }

  /**
   * Deploy using Helm strategy
   */
  private async deployWithHelm(config: DeploymentConfig): Promise<any> {
    logger.info('⚓ Using Helm deployment strategy');

    return this.helmService.deployChart({
      chart_path: '.ibm/pipelines-ts/infrastructure/charts/rhdh',
      release_name: 'rhdh',
      namespace: config.namespace,
      values: {
        global: {
          clusterType: config.clusterType,
          clusterRouterBase: config.routerBase,
        },
        rbac: {
          enabled: config.enableRbac,
        },
        monitoring: {
          enabled: config.enableMonitoring,
        },
      },
      wait_for_deployment: true,
      timeout_seconds: 600,
      atomic: true,
      cleanup_on_fail: true,
      force: false,
      recreate_pods: false,
    });
  }

  /**
   * Deploy using hybrid strategy (Ansible + Helm)
   */
  private async deployWithHybrid(config: DeploymentConfig): Promise<any> {
    logger.info('🔀 Using Hybrid deployment strategy (Ansible + Helm)');

    // Step 1: Generate configurations with Ansible
    const ansibleResult = await this.ansibleService.generateConfigurations({
      cluster_type: config.clusterType,
      namespace: config.namespace,
      router_base: config.routerBase,
      image_repository: this.config.QUAY_REPO,
      image_tag: this.getImageTag(),
      enable_rbac: config.enableRbac,
      enable_monitoring: config.enableMonitoring,
      enable_postgresql: true,
      enable_redis: true,
      enable_github_auth: false,
      enable_kubernetes_plugin: true,
    });

    // Step 2: Deploy with Helm using generated values
    const valuesFile = `${ansibleResult.output_directory}/${config.clusterType}/values.yaml`;

    const helmResult = await this.helmService.deployChart({
      chart_path: '.ibm/pipelines-ts/infrastructure/charts/rhdh',
      release_name: 'rhdh',
      namespace: config.namespace,
      values_files: [valuesFile],
      wait_for_deployment: true,
      timeout_seconds: 600,
      atomic: true,
      cleanup_on_fail: true,
      force: false,
      recreate_pods: false,
    });

    return {
      ansible: ansibleResult,
      helm: helmResult,
      strategy: 'hybrid',
    };
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(namespace: string, releaseName: string): Promise<any> {
    try {
      // Try Helm first
      const helmStatus = await this.helmService.getReleaseStatus(releaseName, namespace);
      return { type: 'helm', status: helmStatus };
    } catch {
      // Fallback to kubectl
      const { kubectl } = await import('../utils/shell.js');
      const result = await kubectl([
        'get',
        'deployment',
        releaseName,
        '-n',
        namespace,
        '-o',
        'json',
      ]);

      if (result.success) {
        return { type: 'kubectl', status: JSON.parse(result.stdout) };
      }

      return { type: 'unknown', status: 'not found' };
    }
  }

  /**
   * Rollback deployment
   */
  async rollback(namespace: string, releaseName: string, revision?: number): Promise<void> {
    logger.info(`⏪ Rolling back deployment: ${releaseName} in ${namespace}`);

    // Try Helm rollback first
    try {
      await this.helmService.rollbackRelease({
        release_name: releaseName,
        namespace,
        ...(revision !== undefined && { revision }),
      });
      logger.info('✅ Helm rollback completed');
    } catch (error) {
      logger.warn('Helm rollback failed, deployment may not be Helm-managed', { error });
      throw error;
    }
  }

  /**
   * Get image tag
   */
  private getImageTag(): string {
    const tagName = process.env.TAG_NAME || '1.5';
    const ghSha = process.env.GH_SHA || 'latest';
    return `${tagName}-${ghSha}`;
  }

  /**
   * Get deployment recommendations
   */
  static getDeploymentRecommendations(scenario: string): {
    strategy: DeploymentStrategy;
    reason: string;
    pros: string[];
    cons: string[];
  } {
    const recommendations: Record<string, any> = {
      'complex-enterprise': {
        strategy: 'ansible',
        reason: 'Ansible excels at handling complex, multi-environment configurations',
        pros: [
          'Dynamic template generation',
          'Handles complex logic',
          'Great for heterogeneous environments',
        ],
        cons: ['Requires Ansible knowledge', 'Not GitOps native'],
      },
      'gitops-pipeline': {
        strategy: 'kustomize',
        reason: 'Kustomize is designed for GitOps and declarative management',
        pros: ['GitOps ready', 'Declarative overlays', 'Version control friendly'],
        cons: ['Less flexible for complex logic', 'Requires overlay maintenance'],
      },
      microservices: {
        strategy: 'helm',
        reason: 'Helm provides excellent dependency management for microservices',
        pros: ['Dependency management', 'Easy rollbacks', 'Package versioning'],
        cons: ['Chart maintenance overhead', 'Complexity for simple deployments'],
      },
      flexible: {
        strategy: 'hybrid',
        reason: 'Hybrid approach provides maximum flexibility',
        pros: ['Best of all worlds', 'Flexible deployment options', 'Handles any scenario'],
        cons: ['More complex setup', 'Requires knowledge of multiple tools'],
      },
    };

    return recommendations[scenario] || recommendations['flexible'];
  }
}
