import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { JobMapper } from './job-mapper.js';
import { getJobDefinition, getAllJobTypes } from '../config/job-definitions.js';
import { createLogger } from './logger.js';

const logger = createLogger({ component: 'cli-helper' });

/**
 * CLI options interface
 */
export interface CliOptions {
  verbose: boolean;
  dryRun: boolean;
  listJobs: boolean;
  jobInfo?: string;
  validateOnly: boolean;
  help: boolean;
}

/**
 * Parse command line arguments
 */
export function parseCliArgs(): CliOptions {
  const argv = yargs(hideBin(process.argv))
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      description: 'Enable verbose logging',
      default: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Show what would be executed without running',
      default: false,
    })
    .option('list-jobs', {
      type: 'boolean',
      description: 'List all available job types',
      default: false,
    })
    .option('job-info', {
      type: 'string',
      description: 'Show detailed information about a specific job type',
    })
    .option('validate-only', {
      type: 'boolean',
      description: 'Only validate environment without executing',
      default: false,
    })
    .help()
    .parseSync();

  return {
    verbose: argv.verbose as boolean,
    dryRun: argv['dry-run'] as boolean,
    listJobs: argv['list-jobs'] as boolean,
    jobInfo: argv['job-info'] as string | undefined,
    validateOnly: argv['validate-only'] as boolean,
    help: argv.help as boolean,
  };
}

/**
 * Validate CLI arguments and handle special commands
 */
export function validateCliArgs(options: CliOptions): boolean {
  // Handle list jobs
  if (options.listJobs) {
    showAvailableJobs();
    return false;
  }

  // Handle job info
  if (options.jobInfo) {
    showJobInfo(options.jobInfo);
    return false;
  }

  // Handle validate only
  if (options.validateOnly) {
    logger.info('🔍 Running in validate-only mode');
    return true;
  }

  return true;
}

/**
 * Setup logging based on CLI options
 */
export function setupLogging(options: CliOptions): void {
  if (options.verbose) {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('Verbose logging enabled');
  }
}

/**
 * Show available job types
 */
export function showAvailableJobs(): void {
  console.log('\n📋 Available Job Types:\n');

  const jobTypes = getAllJobTypes();
  const mappings = JobMapper.getJobMappingsInfo();

  jobTypes.forEach((jobType) => {
    const definition = getJobDefinition(jobType);
    const mapping = mappings.find((m) => m.jobType === jobType);

    if (definition && mapping) {
      console.log(`🎯 ${jobType}`);
      console.log(`   Name: ${definition.name}`);
      console.log(`   Description: ${mapping.description}`);
      console.log(`   Priority: ${mapping.priority}`);
      console.log(`   Deployments: ${definition.deployments.length}`);
      console.log(`   Examples: ${mapping.examples.join(', ')}`);
      console.log('');
    }
  });

  console.log('💡 Use --job-info <type> for detailed information about a specific job\n');
}

/**
 * Show detailed information about a specific job type
 */
export function showJobInfo(jobType: string): void {
  const definition = getJobDefinition(jobType);

  if (!definition) {
    console.error(`❌ Unknown job type: ${jobType}`);
    console.log(`📚 Available job types: ${getAllJobTypes().join(', ')}`);
    return;
  }

  const mappings = JobMapper.getJobMappingsInfo();
  const jobMapping = mappings.find((m) => m.jobType === jobType);

  console.log(`\n🎯 Job Type: ${jobType}\n`);
  console.log(`📋 Details:`);
  console.log(`   Name: ${definition.name}`);
  console.log(`   Description: ${jobMapping?.description || 'N/A'}`);
  console.log(`   Priority: ${jobMapping?.priority || 'N/A'}`);
  console.log(`   Pattern: ${jobMapping?.pattern.source || 'N/A'}`);

  if (definition.requiredEnvVars?.length) {
    console.log(`\n🔐 Required Environment Variables:`);
    definition.requiredEnvVars.forEach((envVar) => {
      const currentValue = process.env[envVar];
      const status = currentValue ? '✅' : '❌';
      console.log(`   ${status} ${envVar}${currentValue ? ' (set)' : ' (missing)'}`);
    });
  }

  if (definition.requiredTools?.length) {
    console.log(`\n🔧 Required Tools:`);
    definition.requiredTools.forEach((tool) => {
      console.log(`   • ${tool}`);
    });
  }

  if (definition.setupCommands?.length) {
    console.log(`\n⚙️  Setup Commands:`);
    definition.setupCommands.forEach((cmd) => {
      console.log(`   $ ${cmd}`);
    });
  }

  console.log(`\n📦 Deployments (${definition.deployments.length}):`);
  definition.deployments.forEach((deployment, index) => {
    console.log(`   ${index + 1}. ${deployment.namespace} → ${deployment.releaseName}`);
    console.log(`      Method: ${deployment.deploymentMethod}`);
    console.log(`      Cluster: ${deployment.cluster}`);
    console.log(`      Values: ${deployment.values}`);
    console.log(`      Test: ${deployment.testProject}`);
  });

  if (jobMapping?.examples.length) {
    console.log(`\n💡 Example Job Names:`);
    jobMapping.examples.forEach((example) => {
      const result = JobMapper.mapJobNameToType(example);
      const status = result.jobType === jobType ? '✅' : '❌';
      console.log(`   ${status} ${example} → ${result.jobType} (${result.confidence}%)`);
    });
  }

  // Test current JOB_NAME if set
  const currentJobName = process.env.JOB_NAME;
  if (currentJobName) {
    console.log(`\n🧪 Current JOB_NAME Test:`);
    const result = JobMapper.mapJobNameToType(currentJobName);
    const status = result.jobType === jobType ? '✅' : '❌';
    console.log(`   ${status} "${currentJobName}" → ${result.jobType} (${result.confidence}%)`);
  }

  console.log('');
}

/**
 * Show dry run information
 */
export function showDryRunInfo(jobName: string, jobType: string): void {
  console.log('\n🌟 DRY RUN MODE 🌟\n');
  console.log(`📋 Job Name: ${jobName}`);
  console.log(`🎯 Job Type: ${jobType}`);

  const definition = getJobDefinition(jobType);
  if (definition) {
    console.log(`📝 Description: ${definition.name}`);
    console.log(`📦 Deployments: ${definition.deployments.length}`);

    console.log('\n🚀 Would execute:');
    if (definition.setupCommands?.length) {
      console.log('\n   Setup Commands:');
      definition.setupCommands.forEach((cmd) => {
        console.log(`   $ ${cmd}`);
      });
    }

    console.log('\n   Deployments:');
    definition.deployments.forEach((deployment, index) => {
      console.log(`   ${index + 1}. ${deployment.namespace} (${deployment.deploymentMethod})`);
    });
  }

  console.log('\n✅ No changes were made (dry run)\n');
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Show execution summary
 */
export function showExecutionSummary(
  jobName: string,
  jobType: string,
  success: boolean,
  duration: number,
  artifactDir?: string
): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXECUTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`📋 Job Name: ${jobName}`);
  console.log(`🎯 Job Type: ${jobType}`);
  console.log(`⏱️  Duration: ${formatDuration(duration)}`);
  console.log(`📈 Result: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);

  if (artifactDir) {
    console.log(`📂 Artifacts: ${artifactDir}`);
  }

  console.log('='.repeat(60) + '\n');
}
