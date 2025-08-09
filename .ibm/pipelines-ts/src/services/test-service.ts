import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Schema for test configuration
 */
const TestConfigSchema = z.object({
  project: z.string(),
  releaseName: z.string(),
  namespace: z.string(),
  baseUrl: z.string(),
  artifactDir: z.string(),
  junitResultsFile: z.string().default('junit-results.xml'),
  testTimeout: z.number().default(600000), // 10 minutes
  retries: z.number().default(2),
  workers: z.number().default(4),
});

/**
 * Schema for test results
 */
const TestResultSchema = z.object({
  success: z.boolean(),
  totalTests: z.number(),
  passedTests: z.number(),
  failedTests: z.number(),
  skippedTests: z.number(),
  duration: z.number(),
  reportPath: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
});

type TestConfig = z.infer<typeof TestConfigSchema>;
type TestResult = z.infer<typeof TestResultSchema>;

/**
 * Service for running and managing e2e tests
 */
export class TestService {
  private readonly e2eTestDir: string;

  constructor(private readonly workspaceRoot: string) {
    // workspaceRoot will be used in future implementations
    this.e2eTestDir = path.join(workspaceRoot, 'e2e-tests');
  }

  /**
   * Run e2e tests for a specific project
   */
  async runTests(config: TestConfig): Promise<TestResult> {
    console.log(`Running tests for project: ${config.project}`);

    try {
      // Validate configuration
      const validatedConfig = TestConfigSchema.parse(config);

      // Set up test environment
      await this.setupTestEnvironment(validatedConfig);

      // Install dependencies
      await this.installDependencies();

      // Install browsers
      await this.installBrowsers();

      // Start virtual display
      const displayProcess = await this.startVirtualDisplay();

      try {
        // Run tests
        const startTime = Date.now();
        await execAsync(`yarn ${validatedConfig.project}`, {
          cwd: this.e2eTestDir,
          env: {
            ...process.env,
            BASE_URL: validatedConfig.baseUrl,
            DISPLAY: ':99',
          },
        });

        const duration = Date.now() - startTime;

        // Process results
        const result = await this.processTestResults(validatedConfig, duration);

        // Save artifacts
        await this.saveArtifacts(validatedConfig);

        return result;
      } finally {
        // Clean up virtual display
        if (displayProcess) {
          displayProcess.kill();
        }
      }
    } catch (error) {
      console.error(`Test execution failed: ${error}`);
      return {
        success: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        duration: 0,
      };
    }
  }

  /**
   * Check if Backstage is running and accessible
   */
  async checkBackstageHealth(url: string, maxAttempts = 30, waitSeconds = 30): Promise<boolean> {
    console.log(`Checking if Backstage is up and running at ${url}`);

    for (let i = 1; i <= maxAttempts; i++) {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          headers: { Accept: 'text/html' },
        });

        if (response.ok) {
          console.log('Backstage is up and running!');
          return true;
        }

        console.log(
          `Attempt ${i}/${maxAttempts}: Backstage not yet available (HTTP ${response.status})`
        );
      } catch (error) {
        console.log(`Attempt ${i}/${maxAttempts}: Failed to reach Backstage - ${error}`);
      }

      if (i < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      }
    }

    console.error(`Failed to reach Backstage at ${url} after ${maxAttempts} attempts`);
    return false;
  }

  /**
   * Save pod logs for debugging
   */
  async savePodLogs(namespace: string, outputDir: string): Promise<void> {
    console.log(`Saving pod logs for namespace: ${namespace}`);

    try {
      // Get all pods in namespace
      const { stdout } = await execAsync(
        `kubectl get pods -n ${namespace} -o jsonpath='{.items[*].metadata.name}'`
      );

      const podNames = stdout.trim().split(' ').filter(Boolean);

      for (const podName of podNames) {
        await this.saveSinglePodLogs(podName, namespace, outputDir);
      }
    } catch (error) {
      console.error(`Failed to save pod logs: ${error}`);
    }
  }

  /**
   * Generate test report
   */
  async generateReport(config: TestConfig, result: TestResult): Promise<string> {
    const report = {
      project: config.project,
      namespace: config.namespace,
      baseUrl: config.baseUrl,
      timestamp: new Date().toISOString(),
      result,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };

    const reportPath = path.join(config.artifactDir, 'test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    return reportPath;
  }

  private async setupTestEnvironment(config: TestConfig): Promise<void> {
    // Create artifact directories
    await fs.mkdir(path.join(config.artifactDir, 'test-results'), { recursive: true });
    await fs.mkdir(path.join(config.artifactDir, 'screenshots'), { recursive: true });
    await fs.mkdir(path.join(config.artifactDir, 'attachments'), { recursive: true });
  }

  private async installDependencies(): Promise<void> {
    console.log('Installing test dependencies...');
    await execAsync('yarn install --immutable', { cwd: this.e2eTestDir });
  }

  private async installBrowsers(): Promise<void> {
    console.log('Installing Playwright browsers...');
    await execAsync('yarn playwright install chromium', { cwd: this.e2eTestDir });
  }

  private async startVirtualDisplay(): Promise<any> {
    console.log('Starting virtual display...');
    const { spawn } = require('child_process');
    return spawn('Xvfb', [':99']);
  }

  private async processTestResults(config: TestConfig, duration: number): Promise<TestResult> {
    const junitPath = path.join(this.e2eTestDir, config.junitResultsFile);

    try {
      const junitContent = await fs.readFile(junitPath, 'utf-8');

      // Parse JUnit XML to extract test counts
      const totalMatch = junitContent.match(/tests="(\d+)"/);
      const failuresMatch = junitContent.match(/failures="(\d+)"/);
      const skippedMatch = junitContent.match(/skipped="(\d+)"/);

      const total = totalMatch?.[1] ? parseInt(totalMatch[1]) : 0;
      const failures = failuresMatch?.[1] ? parseInt(failuresMatch[1]) : 0;
      const skipped = skippedMatch?.[1] ? parseInt(skippedMatch[1]) : 0;
      const passed = total - failures - skipped;

      return {
        success: failures === 0,
        totalTests: total,
        passedTests: passed,
        failedTests: failures,
        skippedTests: skipped,
        duration,
      };
    } catch (error) {
      console.error(`Failed to parse test results: ${error}`);
      return {
        success: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        duration,
      };
    }
  }

  private async saveArtifacts(config: TestConfig): Promise<void> {
    const sources = [
      { from: 'test-results', to: 'test-results' },
      { from: 'screenshots', to: 'screenshots' },
      { from: 'playwright-report', to: 'playwright-report' },
      { from: config.junitResultsFile, to: path.basename(config.junitResultsFile) },
    ];

    for (const { from, to } of sources) {
      const sourcePath = path.join(this.e2eTestDir, from);
      const destPath = path.join(config.artifactDir, to);

      try {
        const stats = await fs.stat(sourcePath);
        if (stats.isDirectory()) {
          await execAsync(`cp -r ${sourcePath}/* ${destPath}/`);
        } else {
          await fs.copyFile(sourcePath, destPath);
        }
      } catch (error) {
        console.warn(`Failed to copy artifact ${from}: ${error}`);
      }
    }
  }

  private async saveSinglePodLogs(
    podName: string,
    namespace: string,
    outputDir: string
  ): Promise<void> {
    try {
      // Get containers in pod
      const { stdout: containersJson } = await execAsync(
        `kubectl get pod ${podName} -n ${namespace} -o jsonpath='{.spec.containers[*].name}'`
      );

      const containers = containersJson.trim().split(' ').filter(Boolean);

      for (const container of containers) {
        // Current logs
        try {
          const { stdout: logs } = await execAsync(
            `kubectl logs ${podName} -c ${container} -n ${namespace}`
          );
          await fs.writeFile(path.join(outputDir, `${podName}_${container}.log`), logs);
        } catch (error) {
          console.warn(`No logs found for container ${container} in pod ${podName}`);
        }

        // Previous logs
        try {
          const { stdout: prevLogs } = await execAsync(
            `kubectl logs ${podName} -c ${container} -n ${namespace} --previous`
          );
          await fs.writeFile(
            path.join(outputDir, `${podName}_${container}-previous.log`),
            prevLogs
          );
        } catch (error) {
          // Previous logs might not exist
        }
      }
    } catch (error) {
      console.error(`Failed to save logs for pod ${podName}: ${error}`);
    }
  }
}
