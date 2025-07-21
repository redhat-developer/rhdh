import { createLogger } from './logger.js';
import { execSync } from 'child_process';

const logger = createLogger({ component: 'env-validator' });

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface EnvironmentRequirement {
  name: string;
  required: boolean;
  defaultValue?: string;
  validator?: (value: string) => boolean;
  description: string;
}

/**
 * Required environment variables by job type
 */
const ENVIRONMENT_REQUIREMENTS: Record<string, EnvironmentRequirement[]> = {
  common: [
    {
      name: 'JOB_NAME',
      required: true,
      description: 'CI job name for pattern matching',
    },
    {
      name: 'WORKSPACE',
      required: false,
      defaultValue: process.cwd(),
      description: 'Workspace root directory',
    },
    {
      name: 'ARTIFACT_DIR',
      required: false,
      defaultValue: '/tmp/artifacts',
      description: 'Directory for storing build artifacts',
    },
  ],

  kubernetes: [
    {
      name: 'K8S_CLUSTER_URL',
      required: true,
      validator: (value) => value.startsWith('https://'),
      description: 'Kubernetes cluster API URL',
    },
    {
      name: 'K8S_CLUSTER_TOKEN',
      required: true,
      validator: (value) => value.length > 10,
      description: 'Kubernetes cluster authentication token',
    },
  ],

  helm: [
    {
      name: 'HELM_CHART_URL',
      required: false,
      defaultValue: 'oci://quay.io/rhdh/chart',
      description: 'Helm chart repository URL',
    },
    {
      name: 'CHART_VERSION',
      required: false,
      defaultValue: 'latest',
      description: 'Helm chart version to deploy',
    },
  ],

  images: [
    {
      name: 'QUAY_REPO',
      required: false,
      defaultValue: 'rhdh-community/rhdh',
      description: 'Container image repository',
    },
    {
      name: 'TAG_NAME',
      required: false,
      defaultValue: 'latest',
      description: 'Container image tag',
    },
  ],
};

/**
 * Command-line tools required by job type
 */
const TOOL_REQUIREMENTS: Record<string, string[]> = {
  common: ['node', 'npm'],
  kubernetes: ['kubectl'],
  openshift: ['oc'],
  helm: ['helm'],
  aks: ['az'],
  gke: ['gcloud'],
  ansible: ['ansible-playbook'],
  kustomize: ['kustomize'],
};

/**
 * Validate environment for pipeline execution
 */
export async function validateEnvironment(jobType?: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  logger.info('Starting environment validation...');

  // Validate environment variables
  await validateEnvironmentVariables(result, jobType);

  // Validate required tools
  await validateRequiredTools(result, jobType);

  // Validate network connectivity
  await validateNetworkConnectivity(result);

  // Validate file system permissions
  await validateFileSystemPermissions(result);

  result.valid = result.errors.length === 0;

  if (result.valid) {
    logger.info('Environment validation passed ✅');
  } else {
    logger.error(`Environment validation failed with ${result.errors.length} errors`);
  }

  return result;
}

/**
 * Validate environment variables
 */
async function validateEnvironmentVariables(
  result: ValidationResult,
  _jobType?: string
): Promise<void> {
  const requirements = [
    ...ENVIRONMENT_REQUIREMENTS.common,
    ...ENVIRONMENT_REQUIREMENTS.kubernetes,
    ...ENVIRONMENT_REQUIREMENTS.helm,
    ...ENVIRONMENT_REQUIREMENTS.images,
  ];

  for (const req of requirements) {
    const value = process.env[req.name];

    if (!value) {
      if (req.required) {
        result.errors.push(
          `Missing required environment variable: ${req.name} - ${req.description}`
        );
      } else {
        if (req.defaultValue) {
          process.env[req.name] = req.defaultValue;
          result.warnings.push(`Using default value for ${req.name}: ${req.defaultValue}`);
        } else {
          result.warnings.push(
            `Optional environment variable not set: ${req.name} - ${req.description}`
          );
        }
      }
      continue;
    }

    // Validate value if validator provided
    if (req.validator && !req.validator(value)) {
      result.errors.push(`Invalid value for ${req.name}: ${value}`);
      result.suggestions.push(`${req.name} should ${req.description}`);
    }
  }
}

/**
 * Validate required command-line tools
 */
async function validateRequiredTools(result: ValidationResult, jobType?: string): Promise<void> {
  const tools = new Set([...TOOL_REQUIREMENTS.common, ...TOOL_REQUIREMENTS.kubernetes]);

  // Add job-specific tools
  if (jobType) {
    const jobTools = TOOL_REQUIREMENTS[jobType] || [];
    jobTools.forEach((tool) => tools.add(tool));
  }

  for (const tool of tools) {
    try {
      execSync(`which ${tool}`, { stdio: 'ignore' });
      logger.debug(`Tool available: ${tool} ✅`);
    } catch (error) {
      result.errors.push(`Required tool not found: ${tool}`);
      result.suggestions.push(`Install ${tool} or ensure it's in your PATH`);
    }
  }
}

/**
 * Validate network connectivity
 */
async function validateNetworkConnectivity(result: ValidationResult): Promise<void> {
  const clusterUrl = process.env.K8S_CLUSTER_URL;

  if (!clusterUrl) {
    return; // Skip if no cluster URL provided
  }

  try {
    // Extract hostname from URL
    const url = new URL(clusterUrl);
    const hostname = url.hostname;

    // Test connectivity (basic ping alternative for Node.js)
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    await execAsync(
      `node -e "
      const https = require('https');
      const req = https.request('${clusterUrl}', { timeout: 5000 }, () => {
        console.log('Connection successful');
        process.exit(0);
      });
      req.on('error', () => process.exit(1));
      req.on('timeout', () => process.exit(1));
      req.end();
    "`,
      { timeout: 10000 }
    );

    logger.debug(`Network connectivity to ${hostname} ✅`);
  } catch (error) {
    result.warnings.push(`Cannot verify network connectivity to cluster: ${clusterUrl}`);
    result.suggestions.push('Ensure you have network access to the Kubernetes cluster');
  }
}

/**
 * Validate file system permissions
 */
async function validateFileSystemPermissions(result: ValidationResult): Promise<void> {
  const dirs = [
    process.env.ARTIFACT_DIR || '/tmp/artifacts',
    process.env.SHARED_DIR || '/tmp/shared',
    process.env.WORKSPACE || process.cwd(),
  ];

  for (const dir of dirs) {
    try {
      const fs = require('fs');

      // Check if directory exists and is writable
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Test write permission
      const testFile = `${dir}/.write-test-${Date.now()}`;
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      logger.debug(`Directory permissions OK: ${dir} ✅`);
    } catch (error) {
      result.errors.push(`Cannot write to directory: ${dir}`);
      result.suggestions.push(`Ensure you have write permissions to ${dir}`);
    }
  }
}

/**
 * Get environment summary for debugging
 */
export function getEnvironmentSummary(): Record<string, any> {
  return {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    env_vars: {
      JOB_NAME: process.env.JOB_NAME,
      WORKSPACE: process.env.WORKSPACE,
      ARTIFACT_DIR: process.env.ARTIFACT_DIR,
      K8S_CLUSTER_URL: process.env.K8S_CLUSTER_URL ? '[REDACTED]' : undefined,
      QUAY_REPO: process.env.QUAY_REPO,
      TAG_NAME: process.env.TAG_NAME,
    },
  };
}
