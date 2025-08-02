import { Job } from '../factories/job-factory.js';
import { JobDefinition, JobDeployment } from '../config/job-definitions.js';
import { MonitoringService } from '../services/monitoring-service.js';
import { DeploymentFactory } from '../factories/deployment-factory.js';
import { TestService } from '../services/test-service.js';
import { createLogger } from '../utils/logger.js';
import { executeCommand } from '../utils/shell.js';

const logger = createLogger({ component: 'generic-job' });

/**
 * Generic job implementation that uses configuration to eliminate code duplication
 */
export class GenericJob implements Job {
  constructor(
    public readonly name: string,
    private readonly definition: JobDefinition,
    private readonly workspaceRoot: string,
    private readonly artifactDir: string,
    private readonly monitoring: MonitoringService
  ) {}

  async execute(): Promise<void> {
    logger.info(`🚀 Starting ${this.definition.name} Job`);

    // Run setup commands if defined
    if (this.definition.setupCommands?.length) {
      logger.info('🔧 Running setup commands...');
      for (const command of this.definition.setupCommands) {
        await this.runSetupCommand(command);
      }
    }

    // Handle special cases
    if (this.definition.type === 'ocp-upgrade') {
      await this.handleUpgradeJob();
      return;
    }

    // Execute all deployments defined in configuration
    for (const deployment of this.definition.deployments) {
      await this.runDeploymentAndTest(deployment);
    }
  }

  /**
   * Run a setup command with proper error handling
   */
  private async runSetupCommand(command: string): Promise<void> {
    logger.info(`Executing setup command: ${command}`);
    const [cmd, ...args] = command.split(' ');

    await executeCommand(cmd, args, {
      throwOnError: true,
      logCommand: true,
      logOutput: false,
    });
  }

  /**
   * Handle upgrade job special case
   */
  private async handleUpgradeJob(): Promise<void> {
    const deployment = this.definition.deployments[0];
    const namespace = deployment.namespace;
    const upgradeFromVersion = deployment.upgradeFromVersion || process.env.CHART_VERSION_BASE;

    if (!upgradeFromVersion) {
      throw new Error('CHART_VERSION_BASE is required for upgrade jobs');
    }

    logger.info(`📦 Deploying base version ${upgradeFromVersion}`);

    // Deploy base version first
    await executeCommand(
      'helm',
      [
        'upgrade',
        '-i',
        'rhdh',
        process.env.HELM_CHART_URL || 'oci://quay.io/rhdh/chart',
        '--version',
        upgradeFromVersion,
        '-n',
        namespace,
        '-f',
        'values_showcase_1.5.yaml',
      ],
      {
        throwOnError: true,
        logCommand: true,
      }
    );

    // Wait for deployment
    await executeCommand(
      'kubectl',
      [
        'wait',
        '--for=condition=Available',
        'deployment/rhdh-backstage',
        '-n',
        namespace,
        '--timeout=300s',
      ],
      {
        throwOnError: true,
        logCommand: true,
      }
    );

    // Upgrade to new version
    await this.runDeploymentAndTest(deployment);
  }

  /**
   * Run deployment and test for a single configuration
   */
  private async runDeploymentAndTest(deployment: JobDeployment): Promise<void> {
    const deploymentId = await this.getNextDeploymentId();
    await this.monitoring.saveDeploymentNamespace(deploymentId, deployment.namespace);

    try {
      // Deploy
      const factory = new DeploymentFactory({
        HELM_CHART_VALUE_FILE_NAME: deployment.values,
        HELM_CHART_RBAC_VALUE_FILE_NAME: deployment.values,
        HELM_CHART_K8S_MERGED_VALUE_FILE_NAME: 'merged-values.yaml',
        HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME: 'merged-rbac-values.yaml',
        QUAY_REPO: process.env.QUAY_REPO || 'rhdh-community/rhdh',
        TAG_NAME: process.env.TAG_NAME || 'latest',
        CHART_VERSION: process.env.CHART_VERSION || 'latest',
        K8S_CLUSTER_URL: process.env.K8S_CLUSTER_URL || '',
        K8S_CLUSTER_TOKEN: process.env.K8S_CLUSTER_TOKEN || '',
        K8S_CLUSTER_ROUTER_BASE: process.env.K8S_CLUSTER_ROUTER_BASE || 'localhost',
      } as any);

      await factory.deploy({
        strategy: deployment.deploymentMethod as any,
        clusterType: deployment.cluster as 'openshift' | 'aks' | 'gke',
        namespace: deployment.namespace,
        routerBase: process.env.K8S_CLUSTER_ROUTER_BASE || 'localhost',
        enableRbac: deployment.values.includes('rbac'),
        enableMonitoring: true,
        dryRun: false,
      });

      await this.monitoring.saveDeploymentFailure(deploymentId, false);

      // Test
      const testService = new TestService(this.workspaceRoot);
      const baseUrl = this.getBaseUrl(deployment);

      const isRunning = await testService.checkBackstageHealth(baseUrl);
      if (!isRunning) {
        throw new Error('Backstage is not accessible');
      }

      const testResult = await testService.runTests({
        project: deployment.testProject,
        releaseName: deployment.releaseName,
        namespace: deployment.namespace,
        baseUrl,
        artifactDir: this.artifactDir,
        junitResultsFile: 'junit-results.xml',
        testTimeout: 600000,
        retries: 2,
        workers: 4,
      });

      await this.monitoring.saveTestFailure(deploymentId, !testResult.success);
      await this.monitoring.saveNumberOfFailedTests(deploymentId, testResult.failedTests);

      // Save pod logs
      await testService.savePodLogs(
        deployment.namespace,
        `${this.artifactDir}/${deployment.namespace}/pod_logs`
      );
    } catch (error) {
      await this.monitoring.saveDeploymentFailure(deploymentId, true);
      await this.monitoring.saveTestFailure(deploymentId, true);
      throw error;
    }
  }

  private async getNextDeploymentId(): Promise<number> {
    // Simple implementation - in real world might read from file/db
    return Date.now();
  }

  private getBaseUrl(deployment: JobDeployment): string {
    const routerBase = process.env.K8S_CLUSTER_ROUTER_BASE || 'localhost';

    if (deployment.cluster === 'ocp' || deployment.cluster === 'openshift') {
      return `https://${deployment.releaseName}-developer-hub-${deployment.namespace}.${routerBase}`;
    } else {
      return `https://${routerBase}`;
    }
  }
}
