import { expect } from "@playwright/test";
import { execFile } from "child_process";
import { Log } from "./logs";
import { LOGGER } from "../../utils/logger";

export class LogUtils {
  /**
   * Executes a command and returns the output as a promise.
   *
   * @param command The command to execute
   * @param args An array of arguments for the command
   * @returns A promise that resolves with the command output
   */
  static executeCommand(command: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          console.error("Error executing command:", error);
          reject(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.warn("stderr warning:", stderr);
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Validates if the actual log matches the expected log values.
   * It compares both primitive and nested object properties.
   *
   * @param actual The actual log returned by the system
   * @param expected The expected log values to validate against
   */
  public static validateLog(actual: Log, expected: Partial<Log>) {
    Object.keys(expected).forEach((key) => {
      const expectedValue = expected[key as keyof Log];
      const actualValue = actual[key as keyof Log];

      LogUtils.compareValues(actualValue, expectedValue);
    });
  }

  /**
   * Compare the actual and expected values. Uses 'toBe' for numbers and 'toContain' for strings/arrays.
   * Handles nested object comparison.
   *
   * @param actual The actual value to compare
   * @param expected The expected value
   */
  private static compareValues(actual: unknown, expected: unknown) {
    if (typeof expected === "object" && expected !== null) {
      Object.keys(expected).forEach((subKey) => {
        const expectedSubValue = expected[subKey];
        const actualSubValue = actual?.[subKey];
        LogUtils.compareValues(actualSubValue, expectedSubValue);
      });
    } else if (typeof expected === "number") {
      expect(actual).toBe(expected);
    } else {
      expect(actual).toContain(expected);
    }
  }

  /**
   * Lists all pods in the specified namespace and returns their details.
   *
   * @param namespace The namespace to list pods from
   * @returns A promise that resolves with the pod details
   */
  static async listPods(namespace: string): Promise<string> {
    const args = ["get", "pods", "-n", namespace, "-o", "wide"];
    try {
      console.log("Fetching pod list with command:", "oc", args.join(" "));
      return await LogUtils.executeCommand("oc", args);
    } catch (error) {
      console.error("Error listing pods:", error);
      throw new Error(
        `Failed to list pods in namespace "${namespace}": ${error}`,
      );
    }
  }

  /**
   * Fetches detailed information about a specific pod.
   *
   * @param podName The name of the pod to fetch details for
   * @param namespace The namespace where the pod is located
   * @returns A promise that resolves with the pod details in JSON format
   */
  static async getPodDetails(
    podName: string,
    namespace: string,
  ): Promise<string> {
    const args = ["get", "pod", podName, "-n", namespace, "-o", "json"];
    try {
      const output = await LogUtils.executeCommand("oc", args);
      console.log(`Details for pod ${podName}:`, output);
      return output;
    } catch (error) {
      console.error(`Error fetching details for pod ${podName}:`, error);
      throw new Error(`Failed to fetch pod details: ${error}`);
    }
  }

  /**
   * Fetches logs with retry logic in case the log is not immediately available.
   *
   * @param filter The string to filter the logs
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelay Delay (in milliseconds) between retries
   * @returns The log line matching the filter, or throws an error if not found
   */
  static async getPodLogsWithRetry(
    filter: string,
    maxRetries: number = 3,
    retryDelay: number = 5000,
  ): Promise<string> {
    const podSelector =
      "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";
    const tailNumber = 30;
    const namespace = process.env.NAME_SPACE || "showcase-ci-nightly";

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(
          `Attempt ${attempt + 1}/${maxRetries + 1}: Fetching logs...`,
        );
        const args = [
          "logs",
          "-l",
          podSelector,
          `--tail=${tailNumber}`,
          "-c",
          "backstage-backend",
          "-n",
          namespace,
        ];

        console.log("Executing command:", "oc", args.join(" "));
        const output = await LogUtils.executeCommand("oc", args);

        console.log("Raw log output:", output);

        const logLines = output.split("\n");
        const filteredLines = logLines.filter((line) => line.includes(filter));

        if (filteredLines.length > 0) {
          console.log("Matching log line found:", filteredLines[0]);
          return filteredLines[0]; // Return the first matching log
        }

        console.warn(
          `No matching logs found for filter "${filter}" on attempt ${
            attempt + 1
          }. Retrying...`,
        );
      } catch (error) {
        console.error(
          `Error fetching logs on attempt ${attempt + 1}:`,
          error.message,
        );
      }

      attempt++;
      if (attempt <= maxRetries) {
        console.log(`Waiting ${retryDelay / 1000} seconds before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error(
      `Failed to fetch logs for filter "${filter}" after ${maxRetries + 1} attempts.`,
    );
  }

  /**
   * Logs in to OpenShift using a token and server URL.
   *
   * @returns A promise that resolves when the login is successful
   */
  static async loginToOpenShift(): Promise<void> {
    const token = process.env.K8S_CLUSTER_TOKEN || "";
    const server = process.env.K8S_CLUSTER_URL || "";

    if (!token || !server) {
      throw new Error(
        "Environment variables K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL must be set.",
      );
    }

    const command = "oc";
    const args = ["login", `--token=${token}`, `--server=${server}`];

    try {
      await LogUtils.executeCommand(command, args);
      console.log("Login successful.");
    } catch (error) {
      LOGGER.error("Error during login:", error);
      throw new Error(`Failed to login to OpenShift: ${error}`);
    }
  }

  /**
   * Validates if the actual log matches the expected log values for a specific event.
   * This is a reusable method for different log validations across various tests.
   *
   * @param eventName The name of the event to filter in the logs
   * @param message The expected log message
   * @param method The HTTP method used in the log (GET, POST, etc.)
   * @param url The URL endpoint that was hit in the log
   * @param baseURL The base URL of the application, used to get the hostname
   * @param plugin The plugin name that triggered the log event
   */
  public static async validateLogEvent(
    eventName: string,
    message: string,
    method: string,
    url: string,
    baseURL: string,
    plugin: string,
  ) {
    try {
      const actualLog = await LogUtils.getPodLogsWithRetry(eventName);
      console.log("Raw log output before filtering:", actualLog);

      let parsedLog: Log;
      try {
        parsedLog = JSON.parse(actualLog);
      } catch (parseError) {
        console.error("Failed to parse log JSON. Log content:", actualLog);
        throw new Error(`Invalid JSON received for log: ${parseError}`);
      }

      const expectedLog: Partial<Log> = {
        actor: {
          hostname: new URL(baseURL).hostname,
        },
        message,
        plugin,
        request: {
          method,
          url,
        },
      };

      console.log("Validating log with expected values:", expectedLog);
      LogUtils.validateLog(parsedLog, expectedLog);
    } catch (error) {
      console.error("Error validating log event:", error);
      console.error("Event name:", eventName);
      console.error("Expected message:", message);
      console.error("Expected method:", method);
      console.error("Expected URL:", url);
      console.error("Base URL:", baseURL);
      console.error("Plugin:", plugin);
      throw error;
    }
  }
}
