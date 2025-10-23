import { expect } from "@playwright/test";
import { execFile, exec } from "child_process";
import { type JsonObject } from "@backstage/types";
import {
  Log,
  type LogRequest,
  type EventStatus,
  type EventSeverityLevel,
} from "./logs";

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
   * Executes a shell command and returns the output as a promise.
   *
   * @param command The shell command to execute
   * @returns A promise that resolves with the command output
   */
  static executeShellCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
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
      if (expectedValue !== undefined) {
        const actualValue = actual[key as keyof Log];
        LogUtils.compareValues(actualValue, expectedValue);
      }
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
    } else if (typeof expected === "string") {
      if (actual === undefined || actual === null) {
        throw new Error(`Expected value "${expected}" but got ${actual}`);
      }
      expect(String(actual)).toContain(expected);
    } else {
      expect(actual).toBe(expected);
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
   * Fetches logs using grep for filtering directly in the shell.
   *
   * @param filterWords The required words the logs must contain to filter the logs
   * @param namespace The namespace to use to retrieve logs from pod
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelay Delay (in milliseconds) between retries
   * @returns The log line matching the filter, or throws an error if not found
   */
  static async getPodLogsWithGrep(
    filterWords: string[] = [],
    namespace: string = process.env.NAME_SPACE || "showcase-ci-nightly",
    maxRetries: number = 4,
    retryDelay: number = 2000,
  ): Promise<string> {
    const podSelector =
      "app.kubernetes.io/component=backstage,app.kubernetes.io/name=developer-hub";
    const tailNumber = 100;

    let grepCommand = `oc logs -l ${podSelector} --tail=${tailNumber} -c backstage-backend -n ${namespace}`;
    for (const word of filterWords) {
      grepCommand += ` | grep '${word}'`;
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(
          `Attempt ${attempt + 1}/${maxRetries + 1}: Fetching logs with grep...`,
        );
        const output = await LogUtils.executeShellCommand(grepCommand);

        const logLines = output
          .split("\n")
          .filter((line) => line.trim() !== "");
        if (logLines.length > 0) {
          console.log("Matching log line found:", logLines[0]);
          return logLines[0]; // Return the first matching log
        }

        console.warn(
          `No matching logs found for filter "${filterWords}" on attempt ${attempt + 1}. Retrying...`,
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
      `Failed to fetch logs for filter "${filterWords}" after ${maxRetries + 1} attempts.`,
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
    const args = [
      "login",
      `--token=${token}`,
      `--server=${server}`,
      `--insecure-skip-tls-verify=true`,
    ];

    try {
      await LogUtils.executeCommand(command, args);
      console.log("Login successful.");
    } catch (error) {
      console.error("Error during login: ", error);
      throw new Error(`Failed to login to OpenShift`);
    }
  }

  /**
   * Validates if the actual log matches the expected log values for a specific event.
   * This is a reusable method for different log validations across various tests.
   *
   * @param eventId The id of the event to filter in the logs
   * @param actorId The id of actor initiating the request
   * @param request The url endpoint and HTTP method (GET, POST, etc.) hit
   * @param meta The metadata about the event
   * @param error The error that occurred
   * @param status The status of event
   * @param plugin The plugin name that triggered the log event
   * @param severityLevel The level of severity of the event
   * @param filterWords The required words the logs must contain to filter the logs besides eventId and request url if specified
   * @param namespace The namespace to use to retrieve logs from pod
   */
  public static async validateLogEvent(
    eventId: string,
    actorId: string,
    request?: LogRequest,
    meta?: JsonObject,
    error?: string,
    status: EventStatus = "succeeded",
    plugin: string = "catalog",
    severityLevel: EventSeverityLevel = "medium",
    filterWords: string[] = [],
    namespace: string = process.env.NAME_SPACE || "showcase-ci-nightly",
  ) {
    const filterWordsAll = [eventId, status, ...filterWords];
    if (request?.method) filterWordsAll.push(request.method);
    if (request?.url) filterWordsAll.push(request.url);
    try {
      const actualLog = await LogUtils.getPodLogsWithGrep(
        filterWordsAll,
        namespace,
      );

      let parsedLog: Log;
      try {
        parsedLog = JSON.parse(actualLog);
      } catch (parseError) {
        console.error("Failed to parse log JSON. Log content:", actualLog);
        throw new Error(`Invalid JSON received for log: ${parseError}`);
      }

      const expectedLog: Partial<Log> = {
        actor: {
          actorId,
        },
        plugin,
        request,
        meta,
        stack: error,
        status,
        severityLevel,
      };

      console.log("Validating log with expected values:", expectedLog);
      LogUtils.validateLog(parsedLog, expectedLog);
    } catch (error) {
      console.error("Error validating log event:", error);
      console.error("Event id:", eventId);
      console.error("Actor id:", actorId);
      console.error("Meta:", meta);
      console.error("Expected method:", request?.method);
      console.error("Expected URL:", request?.url);
      console.error("Plugin:", plugin);
      throw error;
    }
  }
}
