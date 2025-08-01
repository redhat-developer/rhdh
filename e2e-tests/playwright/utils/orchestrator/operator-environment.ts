import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface OperatorEnvironmentInfo {
  isOperatorEnvironment: boolean;
  namespace: string;
  backstageName: string;
  hasPostgreSQL: boolean;
  hasRequiredPermissions: boolean;
  serverlessOperatorsInstalled: boolean;
  errors: string[];
}

export class OperatorEnvironmentValidator {
  private backstageName: string;
  private namespace: string;

  constructor(backstageName: string = 'developer-hub', namespace: string = process.env.BACKSTAGE_NS || process.env.NAME_SPACE || 'showcase') {
    this.backstageName = backstageName;
    this.namespace = namespace;
  }

  /**
   * Validates the operator environment for orchestrator plugin installation
   */
  async validateEnvironment(): Promise<OperatorEnvironmentInfo> {
    const result: OperatorEnvironmentInfo = {
      isOperatorEnvironment: false,
      namespace: this.namespace,
      backstageName: this.backstageName,
      hasPostgreSQL: false,
      hasRequiredPermissions: false,
      serverlessOperatorsInstalled: false,
      errors: [],
    };

    try {
      // Check if we're logged into OpenShift/Kubernetes
      await this.checkAuthenticationStatus(result);
      
      // Validate namespace exists
      await this.validateNamespace(result);
      
      // Check for backstage deployment
      await this.validateBackstageDeployment(result);
      
      // Check PostgreSQL availability
      await this.validatePostgreSQL(result);
      
      // Check required permissions
      await this.validatePermissions(result);
      
      // Check for serverless operators (optional but recommended)
      await this.checkServerlessOperators(result);
      
      // Determine if this is a valid operator environment
      result.isOperatorEnvironment = 
        result.hasRequiredPermissions && 
        result.hasPostgreSQL && 
        result.errors.length === 0;

    } catch (error) {
      result.errors.push(`Environment validation failed: ${error}`);
    }

    return result;
  }

  /**
   * Check if we're authenticated to OpenShift/Kubernetes
   */
  private async checkAuthenticationStatus(result: OperatorEnvironmentInfo): Promise<void> {
    try {
      const { stdout } = await execAsync('oc whoami || kubectl config current-context');
      if (!stdout.trim()) {
        result.errors.push('Not authenticated to OpenShift/Kubernetes cluster');
      }
    } catch (error) {
      result.errors.push('Cannot check authentication status - oc/kubectl not available or not logged in');
    }
  }

  /**
   * Validate that the target namespace exists
   */
  private async validateNamespace(result: OperatorEnvironmentInfo): Promise<void> {
    try {
      const { stdout } = await execAsync(`oc get namespace ${this.namespace} || kubectl get namespace ${this.namespace}`);
      if (!stdout.includes(this.namespace)) {
        result.errors.push(`Namespace '${this.namespace}' does not exist`);
      }
    } catch (error) {
      result.errors.push(`Cannot access namespace '${this.namespace}': ${error}`);
    }
  }

  /**
   * Validate that the backstage deployment exists
   */
  private async validateBackstageDeployment(result: OperatorEnvironmentInfo): Promise<void> {
    try {
      const deploymentName = `backstage-${this.backstageName}`;
      const { stdout } = await execAsync(
        `oc get deployment ${deploymentName} -n ${this.namespace} || kubectl get deployment ${deploymentName} -n ${this.namespace}`
      );
      
      if (!stdout.includes(deploymentName)) {
        result.errors.push(`Backstage deployment '${deploymentName}' not found in namespace '${this.namespace}'`);
      }
    } catch (error) {
      result.errors.push(`Cannot find backstage deployment: ${error}`);
    }
  }

  /**
   * Validate PostgreSQL availability
   */
  private async validatePostgreSQL(result: OperatorEnvironmentInfo): Promise<void> {
    try {
      // Check for PostgreSQL pod
      const { stdout: podOutput } = await execAsync(
        `oc get pods -n ${this.namespace} | grep psql || kubectl get pods -n ${this.namespace} | grep psql || true`
      );
      
      if (!podOutput.trim()) {
        result.errors.push('PostgreSQL pod not found in namespace');
        return;
      }

      // Get the first PostgreSQL pod name
      const psqlPod = podOutput.split('\n')[0]?.split(/\s+/)[0];
      if (!psqlPod) {
        result.errors.push('Cannot determine PostgreSQL pod name');
        return;
      }

      // Test PostgreSQL connectivity
      const { stdout: connectOutput } = await execAsync(
        `oc exec -n ${this.namespace} ${psqlPod} -- psql -U postgres -d postgres -c "SELECT 1;" || ` +
        `kubectl exec -n ${this.namespace} ${psqlPod} -- psql -U postgres -d postgres -c "SELECT 1;" || ` +
        `echo "connection_failed"`
      );

      if (connectOutput.includes('connection_failed') || !connectOutput.includes('1 row')) {
        result.errors.push('Cannot connect to PostgreSQL database');
      } else {
        result.hasPostgreSQL = true;
      }
    } catch (error) {
      result.errors.push(`PostgreSQL validation failed: ${error}`);
    }
  }

  /**
   * Check required permissions for orchestrator setup
   */
  private async validatePermissions(result: OperatorEnvironmentInfo): Promise<void> {
    const requiredPermissions = [
      { resource: 'configmaps', verbs: ['get', 'create', 'delete'] },
      { resource: 'deployments', verbs: ['get', 'patch'] },
      { resource: 'pods', verbs: ['get', 'list'] },
      { resource: 'pods/exec', verbs: ['create'] },
    ];

    let permissionErrors: string[] = [];

    for (const permission of requiredPermissions) {
      for (const verb of permission.verbs) {
        try {
          const { stdout } = await execAsync(
            `oc auth can-i ${verb} ${permission.resource} -n ${this.namespace} || ` +
            `kubectl auth can-i ${verb} ${permission.resource} -n ${this.namespace}`
          );
          
          if (!stdout.includes('yes')) {
            permissionErrors.push(`Missing permission: ${verb} ${permission.resource}`);
          }
        } catch (error) {
          permissionErrors.push(`Cannot check permission ${verb} ${permission.resource}: ${error}`);
        }
      }
    }

    if (permissionErrors.length === 0) {
      result.hasRequiredPermissions = true;
    } else {
      result.errors.push(...permissionErrors);
    }
  }

  /**
   * Check if serverless operators are installed (optional but recommended)
   */
  private async checkServerlessOperators(result: OperatorEnvironmentInfo): Promise<void> {
    try {
      const { stdout } = await execAsync(
        'oc get csv -A | grep -E "(serverless-operator|logic-operator)" || ' +
        'kubectl get csv -A | grep -E "(serverless-operator|logic-operator)" || ' +
        'echo "no_operators_found"'
      );

      if (stdout.includes('serverless-operator') && stdout.includes('logic-operator')) {
        result.serverlessOperatorsInstalled = true;
      } else if (stdout.includes('no_operators_found')) {
        // This is not an error, just a note
        console.log('Serverless operators not found - they will be installed by the setup script');
      }
    } catch (error) {
      console.log('Cannot check serverless operators status:', error);
    }
  }

  /**
   * Check if the orchestrator infrastructure is already installed
   */
  async checkExistingOrchestratorInstallation(): Promise<{
    isInstalled: boolean;
    components: string[];
    issues: string[];
  }> {
    const result = {
      isInstalled: false,
      components: [] as string[],
      issues: [] as string[],
    };

    try {
      // Check for SonataFlowPlatform
      const { stdout: sfpOutput } = await execAsync(
        `oc get sonataflowplatform -n ${this.namespace} || ` +
        `kubectl get sonataflowplatform -n ${this.namespace} || ` +
        `echo "no_sonataflow_platform"`
      );

      if (!sfpOutput.includes('no_sonataflow_platform')) {
        result.components.push('SonataFlowPlatform');
      }

      // Check for orchestrator database
      try {
        const { stdout: podOutput } = await execAsync(
          `oc get pods -n ${this.namespace} | grep psql | awk '{print $1}' | head -1`
        );
        
        const psqlPod = podOutput.trim();
        if (psqlPod) {
          const { stdout: dbOutput } = await execAsync(
            `oc exec -n ${this.namespace} ${psqlPod} -- psql -U postgres -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'backstage_plugin_orchestrator';" | grep "1 row" || echo "no_db"`
          );

          if (!dbOutput.includes('no_db')) {
            result.components.push('Orchestrator Database');
          }
        }
      } catch (error) {
        result.issues.push(`Cannot check orchestrator database: ${error}`);
      }

      // Check for serverless operators
      const { stdout: operatorOutput } = await execAsync(
        'oc get csv -A | grep -E "(serverless-operator|logic-operator)" || echo "no_operators"'
      );

      if (!operatorOutput.includes('no_operators')) {
        result.components.push('Serverless Operators');
      }

      // Check guest authentication configuration
      try {
        const { stdout: configOutput } = await execAsync(
          `oc get cm backstage-appconfig-${this.backstageName} -n ${this.namespace} -o json | jq '.data."default.app-config.yaml"' -r | grep -E "(guest|dangerouslyAllowOutsideDevelopment)" || echo "no_guest_auth"`
        );

        if (!configOutput.includes('no_guest_auth')) {
          result.components.push('Guest Authentication');
        }
      } catch (error) {
        result.issues.push(`Cannot check guest authentication: ${error}`);
      }

      result.isInstalled = result.components.length > 0;

    } catch (error) {
      result.issues.push(`Error checking existing installation: ${error}`);
    }

    return result;
  }

  /**
   * Generate a summary report of the environment validation
   */
  generateValidationReport(info: OperatorEnvironmentInfo): string {
    let report = `\n=== Operator Environment Validation Report ===\n`;
    report += `Namespace: ${info.namespace}\n`;
    report += `Backstage Name: ${info.backstageName}\n`;
    report += `Is Valid Operator Environment: ${info.isOperatorEnvironment ? 'YES' : 'NO'}\n\n`;

    report += `--- Component Status ---\n`;
    report += `PostgreSQL Available: ${info.hasPostgreSQL ? '✓' : '✗'}\n`;
    report += `Required Permissions: ${info.hasRequiredPermissions ? '✓' : '✗'}\n`;
    report += `Serverless Operators: ${info.serverlessOperatorsInstalled ? '✓' : '○ (will be installed)'}\n\n`;

    if (info.errors.length > 0) {
      report += `--- Issues Found ---\n`;
      info.errors.forEach(error => {
        report += `✗ ${error}\n`;
      });
    } else {
      report += `--- Status ---\n✓ Environment is ready for orchestrator installation\n`;
    }

    return report;
  }
}

/**
 * Factory function to create environment validator
 */
export function createEnvironmentValidator(
  backstageName?: string, 
  namespace?: string
): OperatorEnvironmentValidator {
  return new OperatorEnvironmentValidator(backstageName, namespace);
}

/**
 * Quick validation function for use in tests
 */
export async function validateOperatorEnvironment(
  backstageName?: string, 
  namespace?: string
): Promise<OperatorEnvironmentInfo> {
  const validator = createEnvironmentValidator(backstageName, namespace);
  return await validator.validateEnvironment();
}