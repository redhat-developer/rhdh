#!/usr/bin/env node

import { config } from 'dotenv';

import { JobFactory } from './factories/job-factory.js';
import { MonitoringService } from './services/monitoring-service.js';
import { JobMapper } from './utils/job-mapper.js';
import { createLogger } from './utils/logger.js';
import {
  parseCliArgs,
  validateCliArgs,
  setupLogging,
  showDryRunInfo,
  showExecutionSummary,
} from './utils/cli-helper.js';
import { validateEnvironment } from './utils/environment-validator.js';

// Load environment variables
config();

const logger = createLogger({ component: 'main' });

async function main(): Promise<void> {
  const startTime = Date.now();
  let exitCode = 0;
  let jobName = '';
  let jobType = '';

  try {
    // Parse CLI arguments
    const cliOptions = parseCliArgs();

    // Handle CLI commands that don't require execution
    if (!validateCliArgs(cliOptions)) {
      process.exit(0);
    }

    // Setup logging based on CLI options
    setupLogging(cliOptions);

    // Get job name from environment
    jobName = process.env.JOB_NAME || '';
    if (!jobName) {
      throw new Error('JOB_NAME environment variable is required');
    }

    logger.info(`🚀 Starting RHDH Pipeline`);
    logger.info(`📋 Job: ${jobName}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Intelligent job mapping
    const mappingResult = JobMapper.mapJobNameToType(jobName);
    jobType = mappingResult.jobType;

    if (mappingResult.confidence === 0) {
      logger.error(`❌ Unknown job pattern: ${jobName}`);
      if (mappingResult.suggestions?.length) {
        logger.info(`💡 Did you mean one of these: ${mappingResult.suggestions.join(', ')}`);
      }
      logger.info(`📚 Available job types: ${JobMapper.getAvailableJobTypes().join(', ')}`);
      throw new Error(`Cannot map job name to job type: ${jobName}`);
    }

    if (mappingResult.confidence < 80) {
      logger.warn(
        `⚠️  Low confidence mapping (${mappingResult.confidence}%): ${jobName} → ${mappingResult.jobType}`
      );
    } else {
      logger.info(
        `✅ Job mapped: ${jobName} → ${mappingResult.jobType} (${mappingResult.confidence}% confidence)`
      );
    }

    // Handle dry run mode
    if (cliOptions.dryRun) {
      showDryRunInfo(jobName, jobType);
      process.exit(0);
    }

    // Full environment validation (only if not validate-only mode)
    if (!cliOptions.validateOnly) {
      logger.info('🔍 Validating environment...');
      const validationResult = await validateEnvironment(jobType);

      if (!validationResult.valid) {
        logger.error('❌ Environment validation failed');
        validationResult.errors.forEach((error) => logger.error(`  • ${error}`));
        if (validationResult.suggestions.length > 0) {
          logger.info('💡 Suggestions:');
          validationResult.suggestions.forEach((suggestion) => logger.info(`  • ${suggestion}`));
        }
        throw new Error('Environment validation failed');
      }

      if (validationResult.warnings.length > 0) {
        logger.warn('⚠️  Environment warnings:');
        validationResult.warnings.forEach((warning) => logger.warn(`  • ${warning}`));
      }

      logger.info('✅ Environment validation passed');
    }

    // Setup paths
    const workspaceRoot = process.env.WORKSPACE || process.cwd();
    const artifactDir = process.env.ARTIFACT_DIR || '/tmp/artifacts';
    const sharedDir = process.env.SHARED_DIR || '/tmp/shared';

    // Initialize monitoring
    logger.info('📊 Initializing monitoring...');
    const monitoring = new MonitoringService(artifactDir, sharedDir);
    await monitoring.initialize();

    // Create and execute job
    logger.info('🏭 Creating job factory...');
    const jobFactory = new JobFactory(workspaceRoot, artifactDir, monitoring);

    const job = jobFactory.createJob(mappingResult.jobType);
    if (!job) {
      throw new Error(`Job factory failed to create job: ${mappingResult.jobType}`);
    }

    // Execute the job
    logger.info(`🎯 Executing job: ${job.name}`);
    logger.info(`📁 Workspace: ${workspaceRoot}`);
    logger.info(`📂 Artifacts: ${artifactDir}`);

    await job.execute();

    // Generate final report
    logger.info('📈 Generating final report...');
    const report = await monitoring.generateFinalReport();
    exitCode = report.overallResult;

    const resultIcon = exitCode === 0 ? '✅' : '❌';
    logger.info(`${resultIcon} Job completed with result: ${exitCode}`);
  } catch (error) {
    logger.error('💥 Pipeline failed:', error);

    // Enhanced error reporting
    if (error instanceof Error) {
      logger.error(`📍 Error details: ${error.message}`);
      if (error.stack) {
        logger.debug(`📚 Stack trace: ${error.stack}`);
      }
    }

    exitCode = 1;
  }

  const duration = Date.now() - startTime;

  // Show execution summary
  showExecutionSummary(jobName, jobType, exitCode === 0, duration, process.env.ARTIFACT_DIR);

  process.exit(exitCode);
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run main function
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
