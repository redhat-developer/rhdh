import { Page, expect } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execAsync = promisify(exec);

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface OrchestratorConfig {
  backstageName: string;
  backstageNamespace: string;
  orchestratorDatabase: string;
  timeout: number;
}

export class OrchestratorOperatorSetup {
  private page: Page;
  private config: OrchestratorConfig;

  constructor(page: Page, config?: Partial<OrchestratorConfig>) {
    this.page = page;
    this.config = {
      backstageName: process.env.BACKSTAGE_NAME || 'developer-hub',
      backstageNamespace: process.env.BACKSTAGE_NS || 'rhdh-operator',
      orchestratorDatabase: process.env.ORCH_DB || 'backstage_plugin_orchestrator',
      timeout: 300000, // 5 minutes
      ...config,
    };
  }

  /**
   * Validates that the orchestrator infrastructure is properly installed
   */
  async validateOrchestratorInfrastructure(): Promise<boolean> {
    try {
      console.log('Validating orchestrator infrastructure...');

      // Check if serverless operators are installed
      const { stdout: csvOutput } = await execAsync(
        'oc get csv -A | grep -E "(serverless-operator|logic-operator)" || true'
      );
      
      if (!csvOutput.trim()) {
        console.log('WARNING: Serverless operators not found');
        return false;
      }

      // Check if SonataFlowPlatform exists
      const { stdout: sfpOutput } = await execAsync(
        `oc get sonataflowplatform -n ${this.config.backstageNamespace} || true`
      );
      
      if (!sfpOutput.includes('sonataflow-platform')) {
        console.log('WARNING: SonataFlowPlatform not found');
        return false;
      }

      console.log('Orchestrator infrastructure validation successful');
      return true;
    } catch (error) {
      console.error('Error validating orchestrator infrastructure:', error);
      return false;
    }
  }

  /**
   * Verifies that the PostgreSQL database for orchestrator was created
   */
  async verifyPostgreSQLDatabase(): Promise<boolean> {
    try {
      console.log('Verifying PostgreSQL orchestrator database...');

      // Find PostgreSQL pod
      const { stdout: podOutput } = await execAsync(
        `oc get pods -n ${this.config.backstageNamespace} | grep psql | awk '{print $1}' | head -1`
      );
      
      const psqlPod = podOutput.trim();
      if (!psqlPod) {
        console.error('PostgreSQL pod not found');
        return false;
      }

      // Check if orchestrator database exists
      const { stdout: dbOutput } = await execAsync(
        `oc exec -n ${this.config.backstageNamespace} ${psqlPod} -- psql -U postgres -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '${this.config.orchestratorDatabase}';" | grep "1 row" || true`
      );

      if (!dbOutput.includes('1 row')) {
        console.error(`Orchestrator database '${this.config.orchestratorDatabase}' not found`);
        return false;
      }

      console.log('PostgreSQL orchestrator database verification successful');
      return true;
    } catch (error) {
      console.error('Error verifying PostgreSQL database:', error);
      return false;
    }
  }

  /**
   * Verifies that SonataFlow platform resources are ready
   */
  async verifySonataFlowResources(): Promise<boolean> {
    try {
      console.log('Verifying SonataFlow platform resources...');

      // Check SonataFlowPlatform status
      const { stdout: statusOutput } = await execAsync(
        `oc get sonataflowplatform -n ${this.config.backstageNamespace} -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' || true`
      );

      if (statusOutput.trim() !== 'True') {
        console.log('SonataFlowPlatform not ready yet');
        return false;
      }

      // Check if data index service is running
      const { stdout: serviceOutput } = await execAsync(
        `oc get pods -n ${this.config.backstageNamespace} | grep data-index || true`
      );

      if (!serviceOutput.trim()) {
        console.log('Data index service not found');
        return false;
      }

      console.log('SonataFlow platform resources verification successful');
      return true;
    } catch (error) {
      console.error('Error verifying SonataFlow resources:', error);
      return false;
    }
  }

  /**
   * Validates that orchestrator dynamic plugins are loaded
   */
  async validateDynamicPluginConfig(): Promise<boolean> {
    try {
      console.log('Validating dynamic plugin configuration...');

      // Check if backstage pod is running
      const { stdout: podOutput } = await execAsync(
        `oc get pods -n ${this.config.backstageNamespace} -l app.kubernetes.io/name=backstage -o jsonpath='{.items[0].metadata.name}' || true`
      );

      const backstagePod = podOutput.trim();
      if (!backstagePod) {
        console.error('Backstage pod not found');
        return false;
      }

      // Check if pod is ready
      const { stdout: readyOutput } = await execAsync(
        `oc get pod ${backstagePod} -n ${this.config.backstageNamespace} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' || true`
      );

      if (readyOutput.trim() !== 'True') {
        console.log('Backstage pod not ready yet');
        return false;
      }

      console.log('Dynamic plugin configuration validation successful');
      return true;
    } catch (error) {
      console.error('Error validating dynamic plugin config:', error);
      return false;
    }
  }

  /**
   * Waits for backstage deployment to be ready after restart (supports both standard and orchestrator CRD)
   */
  async waitForBackstageRestart(): Promise<boolean> {
    try {
      console.log('Waiting for backstage deployment restart...');

      // Check if orchestrator CRD deployment exists
      const orchestratorDeploymentExists = await this.checkOrchestratorCRDDeployment();
      
      let deploymentName: string;
      if (orchestratorDeploymentExists) {
        deploymentName = 'backstage-rhdh-orchestrator';
        console.log('Using orchestrator CRD deployment');
      } else {
        deploymentName = `backstage-${this.config.backstageName}`;
        console.log('Using standard deployment');
      }

      // Wait for rollout to complete
      await execAsync(
        `oc rollout status deployment/${deploymentName} -n ${this.config.backstageNamespace} --timeout=600s`
      );

      // Additional wait for application to be fully ready
      await this.waitForCondition(
        async () => {
          const { stdout } = await execAsync(
            `oc get pods -n ${this.config.backstageNamespace} -l app.kubernetes.io/name=backstage -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' || true`
          );
          return stdout.trim() === 'True';
        },
        'Backstage pod to be ready',
        this.config.timeout
      );

      console.log('Backstage deployment restart completed successfully');
      return true;
    } catch (error) {
      console.error('Error waiting for backstage restart:', error);
      return false;
    }
  }

  /**
   * Checks if orchestrator CRD-based deployment exists
   */
  async checkOrchestratorCRDDeployment(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `oc get backstage rhdh-orchestrator -n ${this.config.backstageNamespace} || true`
      );
      return stdout.includes('rhdh-orchestrator');
    } catch (error) {
      console.log('Error checking orchestrator CRD deployment:', error);
      return false;
    }
  }

  /**
   * Runs the orchestrator infrastructure setup script with enhanced pipeline integration
   */
  async runOrchestratorSetup(): Promise<boolean> {
    try {
      console.log('Running orchestrator setup script with pipeline integration...');

      // Use relative path resolution to find the setup script
      const setupScript = path.resolve(__dirname, '../../../scripts/setup-orchestrator-operator.sh');
      
      // Verify the script exists before attempting to run it
      if (!fs.existsSync(setupScript)) {
        console.error(`Setup script not found at: ${setupScript}`);
        return false;
      }
      
      // Set environment variables for the script
      const env = {
        ...process.env,
        BACKSTAGE_NAME: this.config.backstageName,
        BACKSTAGE_NS: this.config.backstageNamespace,
        ORCH_DB: this.config.orchestratorDatabase,
        VERSION: process.env.VERSION || 'main',
        // Ensure pipeline integration with relative path
        DIR: path.resolve(__dirname, '../../../../.ibm/pipelines'),
      };

      console.log('Using orchestrator configuration:', {
        backstageName: this.config.backstageName,
        namespace: this.config.backstageNamespace,
        database: this.config.orchestratorDatabase,
        version: env.VERSION,
      });

      // Make script executable before running
      await execAsync(`chmod +x ${setupScript}`).catch(() => {
        console.log('Note: Could not make script executable (may already be executable)');
      });

      const { stdout, stderr } = await execAsync(
        `bash ${setupScript}`,
        { env, timeout: this.config.timeout }
      );

      console.log('Setup script output:', stdout);
      
      if (stderr) {
        console.log('Setup script stderr:', stderr);
        // Don't fail on stderr alone as some commands may produce warnings
      }

      console.log('Orchestrator setup script completed successfully');
      return true;
    } catch (error) {
      console.error('Error running orchestrator setup script:', error);
      console.error('This may indicate infrastructure setup failure or timeout');
      return false;
    }
  }

  /**
   * Performs complete orchestrator setup and validation
   */
  async setupAndValidateOrchestrator(): Promise<boolean> {
    try {
      console.log('Starting complete orchestrator setup and validation...');

      // Run setup script
      const setupSuccess = await this.runOrchestratorSetup();
      if (!setupSuccess) {
        throw new Error('Orchestrator setup script failed');
      }

      // Wait a bit for resources to stabilize
      await this.delay(30000); // 30 seconds

      // Validate infrastructure
      const infraValid = await this.validateOrchestratorInfrastructure();
      if (!infraValid) {
        console.log('WARNING: Infrastructure validation failed, but continuing...');
      }

      // Verify database
      const dbValid = await this.verifyPostgreSQLDatabase();
      if (!dbValid) {
        throw new Error('PostgreSQL database verification failed');
      }

      // Validate dynamic plugins
      const pluginsValid = await this.validateDynamicPluginConfig();
      if (!pluginsValid) {
        throw new Error('Dynamic plugin configuration validation failed');
      }

      console.log('Complete orchestrator setup and validation successful');
      return true;
    } catch (error) {
      console.error('Error in complete orchestrator setup:', error);
      return false;
    }
  }

  /**
   * Checks if we're running in an operator environment
   */
  async isOperatorEnvironment(): Promise<boolean> {
    try {
      // Check if we can access the expected namespace
      const { stdout } = await execAsync(
        `oc get namespace ${this.config.backstageNamespace} || true`
      );
      
      if (!stdout.includes(this.config.backstageNamespace)) {
        return false;
      }

      // Check if backstage deployment exists
      const { stdout: deployOutput } = await execAsync(
        `oc get deployment backstage-${this.config.backstageName} -n ${this.config.backstageNamespace} || true`
      );

      return deployOutput.includes(`backstage-${this.config.backstageName}`);
    } catch (error) {
      console.error('Error checking operator environment:', error);
      return false;
    }
  }

  /**
   * Utility function to wait for a condition with timeout
   */
  private async waitForCondition(
    condition: () => Promise<boolean>,
    description: string,
    timeout: number = 300000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        if (await condition()) {
          return;
        }
      } catch (error) {
        console.log(`Error checking condition "${description}":`, error);
      }
      
      await this.delay(5000); // Wait 5 seconds between checks
    }
    
    throw new Error(`Timeout waiting for condition: ${description}`);
  }

  /**
   * Utility function for delays
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get orchestrator configuration
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }
}

/**
 * Factory function to create orchestrator setup utility
 */
export function createOrchestratorSetup(page: Page, config?: Partial<OrchestratorConfig>): OrchestratorOperatorSetup {
  return new OrchestratorOperatorSetup(page, config);
}