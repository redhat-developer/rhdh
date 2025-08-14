import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Schema for deployment status
 */
const DeploymentStatusSchema = z.object({
  deploymentId: z.number(),
  namespace: z.string(),
  failedToDeploy: z.boolean(),
  testFailed: z.boolean(),
  numberOfFailedTests: z.number().optional(),
  reportPortalUrl: z.string().optional(),
  timestamp: z.string(),
});

/**
 * Schema for overall pipeline result
 */
const PipelineResultSchema = z.object({
  overallResult: z.number(), // 0 = success, 1 = failure
  deployments: z.array(DeploymentStatusSchema),
  artifactsUrl: z.string().optional(),
  jobUrl: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  duration: z.number(),
});

type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;
type PipelineResult = z.infer<typeof PipelineResultSchema>;

/**
 * Service for monitoring and reporting pipeline execution
 */
export class MonitoringService {
  private deployments: DeploymentStatus[] = [];
  private overallResult = 0;
  private startTime: Date;

  constructor(
    private readonly artifactDir: string,
    private readonly sharedDir: string
  ) {
    this.startTime = new Date();
  }

  /**
   * Initialize monitoring directories
   */
  async initialize(): Promise<void> {
    await fs.mkdir(path.join(this.artifactDir, 'reporting'), { recursive: true });
    await fs.mkdir(this.sharedDir, { recursive: true });
  }

  /**
   * Save deployment namespace status
   */
  async saveDeploymentNamespace(deploymentId: number, namespace: string): Promise<void> {
    console.log(`Saving deployment namespace: ${deploymentId} -> ${namespace}`);

    const deployment: DeploymentStatus = {
      deploymentId,
      namespace,
      failedToDeploy: false,
      testFailed: false,
      timestamp: new Date().toISOString(),
    };

    this.deployments[deploymentId - 1] = deployment;
    await this.persistStatus();
  }

  /**
   * Save deployment failure status
   */
  async saveDeploymentFailure(deploymentId: number, failed: boolean): Promise<void> {
    console.log(`Saving deployment failure status: ${deploymentId} -> ${failed}`);

    const deployment = this.deployments[deploymentId - 1];
    if (deployment) {
      deployment.failedToDeploy = failed;
      if (failed) {
        this.overallResult = 1;
      }
      await this.persistStatus();
    }
  }

  /**
   * Save test failure status
   */
  async saveTestFailure(deploymentId: number, failed: boolean): Promise<void> {
    console.log(`Saving test failure status: ${deploymentId} -> ${failed}`);

    const deployment = this.deployments[deploymentId - 1];
    if (deployment) {
      deployment.testFailed = failed;
      if (failed) {
        this.overallResult = 1;
      }
      await this.persistStatus();
    }
  }

  /**
   * Save number of failed tests
   */
  async saveNumberOfFailedTests(deploymentId: number, count: number): Promise<void> {
    console.log(`Saving number of failed tests: ${deploymentId} -> ${count}`);

    const deployment = this.deployments[deploymentId - 1];
    if (deployment) {
      deployment.numberOfFailedTests = count;
      await this.persistStatus();
    }
  }

  /**
   * Save ReportPortal URL
   */
  async saveReportPortalUrl(deploymentId: number, url: string): Promise<void> {
    console.log(`Saving ReportPortal URL: ${deploymentId} -> ${url}`);

    const deployment = this.deployments[deploymentId - 1];
    if (deployment) {
      deployment.reportPortalUrl = url;
      await this.persistStatus();
    }
  }

  /**
   * Set overall result
   */
  async setOverallResult(result: number): Promise<void> {
    console.log(`Setting overall result: ${result}`);
    this.overallResult = result;
    await this.persistStatus();
  }

  /**
   * Get deployment status
   */
  getDeploymentStatus(deploymentId: number): DeploymentStatus | undefined {
    return this.deployments[deploymentId - 1];
  }

  /**
   * Get overall result
   */
  getOverallResult(): number {
    return this.overallResult;
  }

  /**
   * Generate final report
   */
  async generateFinalReport(artifactsUrl?: string, jobUrl?: string): Promise<PipelineResult> {
    const endTime = new Date();
    const duration = endTime.getTime() - this.startTime.getTime();

    const report: PipelineResult = {
      overallResult: this.overallResult,
      deployments: this.deployments.filter(Boolean), // Remove undefined entries
      artifactsUrl,
      jobUrl,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
    };

    // Save final report
    const reportPath = path.join(this.artifactDir, 'reporting', 'final-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    // Generate summary
    await this.generateSummary(report);

    return report;
  }

  /**
   * Send Slack notification
   */
  async sendSlackNotification(webhookUrl: string, report: PipelineResult): Promise<void> {
    const statusEmoji = report.overallResult === 0 ? ':white_check_mark:' : ':x:';
    const status = report.overallResult === 0 ? 'PASSED' : 'FAILED';

    const totalDeployments = report.deployments.length;
    const failedDeployments = report.deployments.filter((d) => d.failedToDeploy).length;
    const failedTests = report.deployments.filter((d) => d.testFailed).length;

    const message = {
      text: `Pipeline Execution ${status} ${statusEmoji}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `Pipeline Execution ${status} ${statusEmoji}`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Total Deployments:*\n${totalDeployments}`,
            },
            {
              type: 'mrkdwn',
              text: `*Failed Deployments:*\n${failedDeployments}`,
            },
            {
              type: 'mrkdwn',
              text: `*Failed Tests:*\n${failedTests}`,
            },
            {
              type: 'mrkdwn',
              text: `*Duration:*\n${this.formatDuration(report.duration)}`,
            },
          ],
        },
      ],
    };

    if (report.jobUrl) {
      message.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${report.jobUrl}|View Job Details>`,
        },
      });
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        console.error(`Failed to send Slack notification: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error sending Slack notification: ${error}`);
    }
  }

  /**
   * Get artifacts URL based on CI environment
   */
  getArtifactsUrl(params: {
    isPullRequest: boolean;
    pullNumber?: string;
    jobName: string;
    buildId: string;
    repoOwner: string;
    repoName: string;
  }): string {
    const baseUrl = 'https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results';

    if (params.isPullRequest && params.pullNumber) {
      return `${baseUrl}/pr-logs/pull/${params.repoOwner}_${params.repoName}/${params.pullNumber}/${params.jobName}/${params.buildId}/artifacts/e2e-tests/${params.repoOwner}-${params.repoName}/artifacts`;
    } else {
      return `${baseUrl}/logs/${params.jobName}/${params.buildId}/artifacts`;
    }
  }

  /**
   * Get job URL based on CI environment
   */
  getJobUrl(params: {
    isPullRequest: boolean;
    pullNumber?: string;
    jobName: string;
    buildId: string;
    repoOwner: string;
    repoName: string;
  }): string {
    const baseUrl = 'https://prow.ci.openshift.org/view/gs/test-platform-results';

    if (params.isPullRequest && params.pullNumber) {
      return `${baseUrl}/pr-logs/pull/${params.repoOwner}_${params.repoName}/${params.pullNumber}/${params.jobName}/${params.buildId}`;
    } else {
      return `${baseUrl}/logs/${params.jobName}/${params.buildId}`;
    }
  }

  private async persistStatus(): Promise<void> {
    // Save individual status files for backward compatibility
    const statusDir = path.join(this.sharedDir);

    // Save deployment namespaces
    const namespaces = this.deployments.map((d) => d?.namespace || '').join('\n');
    await fs.writeFile(path.join(statusDir, 'STATUS_DEPLOYMENT_NAMESPACE.txt'), namespaces);

    // Save failure statuses
    const deployFailures = this.deployments.map((d) => d?.failedToDeploy || false).join('\n');
    await fs.writeFile(path.join(statusDir, 'STATUS_FAILED_TO_DEPLOY.txt'), deployFailures);

    const testFailures = this.deployments.map((d) => d?.testFailed || false).join('\n');
    await fs.writeFile(path.join(statusDir, 'STATUS_TEST_FAILED.txt'), testFailures);

    // Save test counts
    const testCounts = this.deployments.map((d) => d?.numberOfFailedTests || 0).join('\n');
    await fs.writeFile(path.join(statusDir, 'STATUS_NUMBER_OF_TEST_FAILED.txt'), testCounts);

    // Save overall result
    await fs.writeFile(path.join(statusDir, 'OVERALL_RESULT.txt'), this.overallResult.toString());

    // Copy to artifacts directory
    await this.copyToArtifacts();
  }

  private async copyToArtifacts(): Promise<void> {
    const files = [
      'STATUS_DEPLOYMENT_NAMESPACE.txt',
      'STATUS_FAILED_TO_DEPLOY.txt',
      'STATUS_TEST_FAILED.txt',
      'STATUS_NUMBER_OF_TEST_FAILED.txt',
      'OVERALL_RESULT.txt',
    ];

    for (const file of files) {
      const source = path.join(this.sharedDir, file);
      const dest = path.join(this.artifactDir, 'reporting', file);

      try {
        await fs.copyFile(source, dest);
      } catch (error) {
        console.warn(`Failed to copy ${file}: ${error}`);
      }
    }
  }

  private async generateSummary(report: PipelineResult): Promise<void> {
    const summary = [
      '# Pipeline Execution Summary',
      '',
      `**Status:** ${report.overallResult === 0 ? 'SUCCESS ✅' : 'FAILURE ❌'}`,
      `**Duration:** ${this.formatDuration(report.duration)}`,
      `**Start Time:** ${report.startTime}`,
      `**End Time:** ${report.endTime}`,
      '',
      '## Deployments',
      '',
    ];

    for (const deployment of report.deployments) {
      summary.push(`### ${deployment.namespace}`);
      summary.push(
        `- Deployment Status: ${deployment.failedToDeploy ? 'FAILED ❌' : 'SUCCESS ✅'}`
      );
      summary.push(`- Test Status: ${deployment.testFailed ? 'FAILED ❌' : 'SUCCESS ✅'}`);
      if (deployment.numberOfFailedTests !== undefined) {
        summary.push(`- Failed Tests: ${deployment.numberOfFailedTests}`);
      }
      if (deployment.reportPortalUrl) {
        summary.push(`- [ReportPortal](${deployment.reportPortalUrl})`);
      }
      summary.push('');
    }

    if (report.artifactsUrl) {
      summary.push(`## [View Artifacts](${report.artifactsUrl})`);
    }

    if (report.jobUrl) {
      summary.push(`## [View Job](${report.jobUrl})`);
    }

    const summaryPath = path.join(this.artifactDir, 'reporting', 'summary.md');
    await fs.writeFile(summaryPath, summary.join('\n'));
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
