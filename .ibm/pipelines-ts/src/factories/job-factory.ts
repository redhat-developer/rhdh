import { MonitoringService } from '../services/monitoring-service.js';
import { GenericJob } from '../jobs/generic-job.js';
import { getJobDefinition, getAllJobTypes } from '../config/job-definitions.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ component: 'job-factory' });

/**
 * Interface for CI/CD jobs
 */
export interface Job {
  name: string;
  execute(): Promise<void>;
}

/**
 * Factory for creating CI/CD jobs
 * Now uses configuration-driven approach to eliminate code duplication
 */
export class JobFactory {
  constructor(
    private readonly workspaceRoot: string,
    private readonly artifactDir: string,
    private readonly monitoring: MonitoringService
  ) {}

  /**
   * Create a job instance based on job type
   */
  createJob(jobType: string): Job | null {
    const definition = getJobDefinition(jobType);

    if (!definition) {
      logger.warn(`Unknown job type: ${jobType}`);
      return null;
    }

    logger.info(`Creating job: ${definition.name} (${jobType})`);

    return new GenericJob(
      jobType,
      definition,
      this.workspaceRoot,
      this.artifactDir,
      this.monitoring
    );
  }

  /**
   * List all available job types
   */
  listJobs(): string[] {
    return getAllJobTypes();
  }

  /**
   * Get job information by type
   */
  getJobInfo(jobType: string): {
    name: string;
    description: string;
    deployments: number;
    requiredEnvVars?: string[];
    requiredTools?: string[];
  } | null {
    const definition = getJobDefinition(jobType);

    if (!definition) {
      return null;
    }

    return {
      name: definition.name,
      description: definition.description,
      deployments: definition.deployments.length,
      requiredEnvVars: definition.requiredEnvVars,
      requiredTools: definition.requiredTools,
    };
  }

  /**
   * Validate if all required environment variables are set for a job
   */
  validateJobEnvironment(jobType: string): {
    valid: boolean;
    missingVars: string[];
  } {
    const definition = getJobDefinition(jobType);

    if (!definition) {
      return { valid: false, missingVars: [] };
    }

    const missingVars = (definition.requiredEnvVars || []).filter(
      (varName) => !process.env[varName]
    );

    return {
      valid: missingVars.length === 0,
      missingVars,
    };
  }

  /**
   * Get job deployment summary
   */
  getJobDeploymentSummary(jobType: string): string[] {
    const definition = getJobDefinition(jobType);

    if (!definition) {
      return [];
    }

    return definition.deployments.map(
      (deployment) =>
        `${deployment.namespace} → ${deployment.releaseName} (${deployment.deploymentMethod})`
    );
  }
}
