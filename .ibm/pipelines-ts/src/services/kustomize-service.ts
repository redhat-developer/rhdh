import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { executeCommand, kubectl } from '../utils/shell.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const kustomizeLogger = createLogger({ component: 'kustomize' });

/**
 * Kustomize configuration schema
 */
export const KustomizeConfigSchema = z.object({
  cluster_type: z.enum(['openshift', 'aks', 'gke']),
  namespace: z.string().min(1),
  router_base: z.string().min(1),
  image_tag: z.string().min(1),
  dry_run: z.boolean().default(false),
  wait_for_deployment: z.boolean().default(true),
  prune: z.boolean().default(false),
  force_conflicts: z.boolean().default(false),
  server_side_apply: z.boolean().default(true),
});

export type KustomizeConfig = z.infer<typeof KustomizeConfigSchema>;

/**
 * Kustomize result schema
 */
export const KustomizeResultSchema = z.object({
  success: z.boolean(),
  cluster_type: z.string(),
  overlay_path: z.string(),
  applied_resources: z.array(z.string()),
  execution_time: z.number(),
  dry_run: z.boolean(),
});

export type KustomizeResult = z.infer<typeof KustomizeResultSchema>;

/**
 * Kustomize Service
 *
 * This service provides declarative overlay-based deployment using Kustomize,
 * replacing manual kubectl apply scripts with GitOps-ready configurations.
 *
 * Benefits:
 * - Declarative resource management
 * - Cluster-specific overlays without duplication
 * - GitOps-compatible structure
 * - Easy rollback and version control
 * - Server-side apply for large resources
 */
export class KustomizeService {
  private readonly logger = kustomizeLogger;
  private readonly baseDir = '.ibm/pipelines-ts/infrastructure/kustomize';
  private readonly artifactDir = '/tmp/kustomize-artifacts';

  constructor() {
    // Ensure artifact directory exists
    mkdirSync(this.artifactDir, { recursive: true });
  }

  /**
   * Apply Kustomize overlay
   */
  async applyOverlay(config: KustomizeConfig): Promise<KustomizeResult> {
    const validatedConfig = KustomizeConfigSchema.parse(config);
    const startTime = Date.now();

    this.logger.info(`🧩 Applying Kustomize overlay for ${validatedConfig.cluster_type}`);

    try {
      // Get overlay path
      const overlayPath = this.getOverlayPath(validatedConfig.cluster_type);

      // Validate overlay exists
      if (!existsSync(overlayPath)) {
        throw new Error(`Overlay not found: ${overlayPath}`);
      }

      // Build kustomization if needed
      const builtManifests = await this.buildKustomization(overlayPath, validatedConfig);

      // Apply or dry-run
      const appliedResources = await this.applyManifests(builtManifests, validatedConfig);

      // Wait for deployment if requested
      if (validatedConfig.wait_for_deployment && !validatedConfig.dry_run) {
        await this.waitForResources(validatedConfig.namespace);
      }

      this.logger.info(`✅ Kustomize overlay applied successfully`);

      return {
        success: true,
        cluster_type: validatedConfig.cluster_type,
        overlay_path: overlayPath,
        applied_resources: appliedResources,
        execution_time: Date.now() - startTime,
        dry_run: validatedConfig.dry_run,
      };
    } catch (error) {
      this.logger.error(`❌ Kustomize overlay application failed:`, error);
      throw error;
    }
  }

  /**
   * Get overlay path for cluster type
   */
  private getOverlayPath(clusterType: string): string {
    return join(this.baseDir, 'overlays', clusterType);
  }

  /**
   * Build kustomization
   */
  private async buildKustomization(overlayPath: string, config: KustomizeConfig): Promise<string> {
    this.logger.info(`🏗️ Building kustomization from ${overlayPath}`);

    // Create temporary kustomization with dynamic values
    const tempKustomization = await this.createTempKustomization(overlayPath, config);

    // Build with kustomize
    const result = await executeCommand('kustomize', ['build', tempKustomization], {
      throwOnError: false,
    });

    if (!result.success) {
      throw new Error(`Kustomize build failed: ${result.stderr}`);
    }

    // Save built manifests
    const manifestsFile = join(this.artifactDir, `${config.cluster_type}-manifests.yaml`);
    writeFileSync(manifestsFile, result.stdout);

    this.logger.info(`📝 Built manifests saved to ${manifestsFile}`);

    return manifestsFile;
  }

  /**
   * Create temporary kustomization with replacements
   */
  private async createTempKustomization(
    overlayPath: string,
    config: KustomizeConfig
  ): Promise<string> {
    const tempDir = join(this.artifactDir, `overlay-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Copy overlay files
    await executeCommand('cp', ['-r', `${overlayPath}/.`, tempDir], {
      throwOnError: true,
    });

    // Create replacements for dynamic values
    const replacements = [
      {
        source: {
          kind: 'ConfigMap',
          name: 'env-config',
          fieldPath: 'data.NAMESPACE',
        },
        targets: [
          {
            select: {
              kind: 'Deployment',
            },
            fieldPaths: ['metadata.namespace'],
          },
          {
            select: {
              kind: 'Service',
            },
            fieldPaths: ['metadata.namespace'],
          },
        ],
      },
      {
        source: {
          kind: 'ConfigMap',
          name: 'env-config',
          fieldPath: 'data.ROUTER_BASE',
        },
        targets: [
          {
            select: {
              kind: 'Ingress',
            },
            fieldPaths: ['spec.rules.[0].host'],
          },
          {
            select: {
              kind: 'Route',
            },
            fieldPaths: ['spec.host'],
          },
        ],
      },
    ];

    // Update kustomization.yaml with replacements
    const kustomizationPath = join(tempDir, 'kustomization.yaml');
    const kustomizationContent = await executeCommand('cat', [kustomizationPath]).then(
      (r) => r.stdout
    );
    const kustomization = yaml.load(kustomizationContent) as any;

    kustomization.replacements = replacements;

    // Add namespace transformer
    kustomization.namespace = config.namespace;

    // Add image transformer for specific tag
    kustomization.images = [
      {
        name: 'quay.io/rhdh/rhdh-hub-rhel9',
        newTag: config.image_tag,
      },
    ];

    // Write updated kustomization
    writeFileSync(kustomizationPath, yaml.dump(kustomization));

    // Create env-config ConfigMap
    const envConfigMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'env-config',
      },
      data: {
        NAMESPACE: config.namespace,
        ROUTER_BASE: config.router_base,
        CLUSTER_TYPE: config.cluster_type,
      },
    };

    writeFileSync(join(tempDir, 'env-config.yaml'), yaml.dump(envConfigMap));

    // Add env-config to resources
    kustomization.resources = kustomization.resources || [];
    kustomization.resources.push('env-config.yaml');

    writeFileSync(kustomizationPath, yaml.dump(kustomization));

    return tempDir;
  }

  /**
   * Apply manifests to cluster
   */
  private async applyManifests(manifestsFile: string, config: KustomizeConfig): Promise<string[]> {
    const args = ['apply', '-f', manifestsFile];

    if (config.dry_run) {
      args.push('--dry-run=client');
    }

    if (config.server_side_apply) {
      args.push('--server-side');
    }

    if (config.force_conflicts) {
      args.push('--force-conflicts');
    }

    if (config.prune) {
      args.push('--prune');
      args.push('-l', `app.kubernetes.io/managed-by=kustomize`);
    }

    this.logger.info(`📦 Applying manifests ${config.dry_run ? '(dry-run)' : ''}`);

    const result = await kubectl(args, {
      throwOnError: false,
      logOutput: true,
    });

    if (!result.success) {
      throw new Error(`Failed to apply manifests: ${result.stderr}`);
    }

    // Parse applied resources from output
    const appliedResources = result.stdout
      .split('\n')
      .filter((line) => line.includes(' created') || line.includes(' configured'))
      .map((line) => line.split(' ')[0])
      .filter((resource): resource is string => resource !== undefined);

    return appliedResources;
  }

  /**
   * Wait for resources to be ready
   */
  private async waitForResources(namespace: string): Promise<void> {
    this.logger.info(`⏳ Waiting for resources in namespace ${namespace}`);

    // Wait for deployments
    const deployments = await kubectl([
      'get',
      'deployments',
      '-n',
      namespace,
      '-o',
      'jsonpath={.items[*].metadata.name}',
    ]);

    if (deployments.success && deployments.stdout.trim()) {
      const deploymentNames = deployments.stdout.trim().split(' ');

      for (const deployment of deploymentNames) {
        this.logger.info(`Waiting for deployment: ${deployment}`);

        const waitResult = await kubectl(
          [
            'wait',
            'deployment',
            deployment,
            '-n',
            namespace,
            '--for=condition=Available',
            '--timeout=600s',
          ],
          {
            throwOnError: false,
          }
        );

        if (!waitResult.success) {
          this.logger.warn(`Deployment ${deployment} did not become ready`);
        }
      }
    }

    this.logger.info('✅ All resources processed');
  }

  /**
   * Delete resources using Kustomize overlay
   */
  async deleteResources(config: {
    cluster_type: 'openshift' | 'aks' | 'gke';
    namespace: string;
  }): Promise<void> {
    this.logger.info(`🗑️ Deleting resources for ${config.cluster_type}`);

    const overlayPath = this.getOverlayPath(config.cluster_type);

    const result = await executeCommand('kustomize', ['build', overlayPath], {
      throwOnError: false,
    });

    if (!result.success) {
      throw new Error(`Failed to build kustomization: ${result.stderr}`);
    }

    // Delete using kubectl
    const deleteResult = await kubectl(['delete', '-f', '-'], {
      input: result.stdout,
      throwOnError: false,
    });

    if (!deleteResult.success) {
      this.logger.warn(`Some resources may not have been deleted: ${deleteResult.stderr}`);
    }

    this.logger.info('✅ Resources deleted');
  }

  /**
   * Validate Kustomize setup
   */
  async validateKustomizeSetup(): Promise<boolean> {
    try {
      // Check if kustomize is installed
      const versionResult = await executeCommand('kustomize', ['version'], {
        throwOnError: false,
      });

      if (!versionResult.success) {
        this.logger.error('Kustomize is not installed or not in PATH');
        return false;
      }

      this.logger.info(`Kustomize version: ${versionResult.stdout.trim()}`);

      // Check if base and overlays exist
      const basePath = join(this.baseDir, 'base');
      const overlaysPath = join(this.baseDir, 'overlays');

      if (!existsSync(basePath)) {
        this.logger.error(`Kustomize base not found: ${basePath}`);
        return false;
      }

      if (!existsSync(overlaysPath)) {
        this.logger.error(`Kustomize overlays not found: ${overlaysPath}`);
        return false;
      }

      // Validate each overlay
      const overlays = ['openshift', 'aks', 'gke'];
      for (const overlay of overlays) {
        const overlayPath = join(overlaysPath, overlay);
        if (!existsSync(overlayPath)) {
          this.logger.warn(`Overlay not found: ${overlayPath}`);
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Kustomize validation failed:', error);
      return false;
    }
  }

  /**
   * Preview changes (diff)
   */
  async previewChanges(config: KustomizeConfig): Promise<string> {
    const validatedConfig = KustomizeConfigSchema.parse(config);

    // Build current state
    const overlayPath = this.getOverlayPath(validatedConfig.cluster_type);
    const tempKustomization = await this.createTempKustomization(overlayPath, validatedConfig);

    const buildResult = await executeCommand('kustomize', ['build', tempKustomization], {
      throwOnError: false,
    });

    if (!buildResult.success) {
      throw new Error(`Failed to build kustomization: ${buildResult.stderr}`);
    }

    // Get current state from cluster
    await kubectl(['get', '-n', validatedConfig.namespace, '-o', 'yaml', 'all'], {
      throwOnError: false,
    });

    // Use kubectl diff
    const diffResult = await kubectl(['diff', '-f', '-'], {
      input: buildResult.stdout,
      throwOnError: false,
    });

    return diffResult.stdout || 'No changes detected';
  }

  /**
   * Export manifests
   */
  async exportManifests(config: KustomizeConfig, outputPath: string): Promise<void> {
    const validatedConfig = KustomizeConfigSchema.parse(config);

    const overlayPath = this.getOverlayPath(validatedConfig.cluster_type);
    const builtManifests = await this.buildKustomization(overlayPath, validatedConfig);

    // Copy to output path
    await executeCommand('cp', [builtManifests, outputPath], {
      throwOnError: true,
    });

    this.logger.info(`📁 Manifests exported to ${outputPath}`);
  }
}
