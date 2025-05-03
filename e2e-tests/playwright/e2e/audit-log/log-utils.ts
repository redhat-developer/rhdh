import { expect } from "@playwright/test";
import { exec, execFile } from "child_process";
import { Log } from "./logs";

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
   * Executes a command with shell support and returns the output as a promise.
   * This allows the use of pipes and other shell features.
   *
   * @param command The full command to execute including pipes and shell features
   * @returns A promise that resolves with the command output
   */
  static executeShellCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          // If the command failed but it's just because grep didn't find anything,
          // we should return an empty string rather than rejecting
          if (error.code === 1 && !stderr) {
            resolve("");
            return;
          }
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
   * Handles nested object comparison with better error reporting.
   *
   * @param actual The actual value to compare
   * @param expected The expected value
   */
  private static compareValues(actual: unknown, expected: unknown) {
    if (actual === undefined) {
      throw new Error(
        `Expected value exists but actual value is undefined. Expected: ${JSON.stringify(expected)}`,
      );
    }

    if (typeof expected === "object" && expected !== null) {
      Object.keys(expected).forEach((subKey) => {
        const expectedSubValue = expected[subKey];
        const actualSubValue = actual?.[subKey];

        if (actualSubValue === undefined) {
          throw new Error(
            `Expected sub-value exists for key '${subKey}' but actual value is undefined. Expected: ${JSON.stringify(expectedSubValue)}`,
          );
        }

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
   * Fetches logs from OpenShift with retry logic and filters by isAuditEvent and a specified string.
   * Uses grep directly in the shell command for more efficient filtering.
   *
   * @param filter The string to filter the logs (eventId)
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelay Delay (in milliseconds) between retries
   * @returns A promise that resolves to the raw log string matching the filter
   */
  static async getPodLogsWithRetry(
    filter: string,
    maxRetries: number = 3,
    retryDelay: number = 5000,
  ): Promise<string> {
    const podSelector =
      "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";

    const namespace = process.env.NAME_SPACE || "showcase-ci-nightly";

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(
          `Attempt ${attempt + 1}/${maxRetries + 1}: Fetching logs...`,
        );

        // Using shell execution to include grep in the command
        const command = `oc logs -l ${podSelector} -c backstage-backend -n ${namespace} | grep isAuditEvent`;

        console.log("Executing command:", command);
        const output = await this.executeShellCommand(command);

        // Further filter by the specific filter provided (e.g., eventId)
        const logLines = output
          .split("\n")
          .filter((line) => line.trim() !== "");
        const filteredLines = logLines.filter((line) => line.includes(filter));

        if (filteredLines.length > 0) {
          console.log("Matching log line found:", filteredLines[0]);
          return filteredLines[0]; // Return the first matching log line
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
    const args = [
      "login",
      `--token=${token}`,
      `--server=${server}`,
      "--insecure-skip-tls-verify=true",
    ];

    try {
      await LogUtils.executeCommand(command, args);
      console.log("Login successful.");
    } catch (error) {
      console.error("Error during login");
      throw new Error(`Failed to login to OpenShift`);
    }
  }

  /**
   * Parses a Backstage log string into a structured Log object.
   * Handles ANSI color codes and properly extracts nested JSON objects from the log.
   *
   * @param logText The raw log text to parse
   * @returns A structured Log object with extracted fields
   */
  private static parseBackstageLog(logText: string): Log {
    // Remove ANSI color codes from the log text
    const cleanedLog = logText.replace(/\x1B\[\d+m/g, "");

    const log: Log = {
      isAuditEvent: true, // Since we're filtering by isAuditEvent=true
    };

    // Extract timestamp
    const timestampMatch = cleanedLog.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,
    );
    if (timestampMatch) {
      log.timestamp = timestampMatch[1];
    }

    // Extract plugin and message details
    const parts = cleanedLog.split(" ");
    if (parts.length > 1) {
      log.plugin = parts[1]; // 'catalog'
    }
    if (parts.length > 3) {
      log.message = parts[3]; // 'catalog.entity-mutate'
    }

    // Extract eventId
    const eventIdMatch = cleanedLog.match(/eventId="([^"]+)"/);
    if (eventIdMatch) {
      log.eventId = eventIdMatch[1];
    }

    // Extract severityLevel
    const severityMatch = cleanedLog.match(/severityLevel="([^"]+)"/);
    if (severityMatch) {
      log.severityLevel = severityMatch[1];
    }

    // Helper function to extract JSON objects
    const extractJson = (prefix: string): any => {
      const startIdx = cleanedLog.indexOf(`${prefix}=`);
      if (startIdx === -1) return null;

      let jsonStr = "";
      let depth = 0;
      let inQuote = false;
      let escaping = false;
      let started = false;

      for (let i = startIdx + prefix.length + 1; i < cleanedLog.length; i++) {
        const char = cleanedLog[i];

        if (!started) {
          if (char === "{") {
            started = true;
            depth = 1;
            jsonStr += char;
          }
          continue;
        }

        if (escaping) {
          jsonStr += char;
          escaping = false;
          continue;
        }

        if (char === "\\") {
          jsonStr += char;
          escaping = true;
          continue;
        }

        if (char === '"' && !escaping) {
          inQuote = !inQuote;
        }

        if (!inQuote) {
          if (char === "{") depth++;
          if (char === "}") depth--;
        }

        jsonStr += char;

        if (depth === 0) break;
      }

      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        console.error(`Failed to parse ${prefix} JSON:`, jsonStr, e);
        return null;
      }
    };

    // Extract JSON objects
    log.actor = extractJson("actor");
    log.request = extractJson("request");
    log.meta = extractJson("meta");

    // Extract status
    const statusMatch = cleanedLog.match(/status="([^"]+)"/);
    if (statusMatch) {
      log.status = statusMatch[1];
    }

    // Extract trace information
    const traceIdMatch = cleanedLog.match(/trace_id="([^"]+)"/);
    if (traceIdMatch) {
      log.trace_id = traceIdMatch[1];
    }

    const spanIdMatch = cleanedLog.match(/span_id="([^"]+)"/);
    if (spanIdMatch) {
      log.span_id = spanIdMatch[1];
    }

    const traceFlagsMatch = cleanedLog.match(/trace_flags="([^"]+)"/);
    if (traceFlagsMatch) {
      log.trace_flags = traceFlagsMatch[1];
    }

    // Add debug output with all parsed fields
    console.log("Parsed log fields:");
    console.log("- timestamp:", log.timestamp);
    console.log("- plugin:", log.plugin);
    console.log("- message:", log.message);
    console.log("- eventId:", log.eventId);
    console.log("- actor:", JSON.stringify(log.actor));
    console.log("- request:", JSON.stringify(log.request));
    console.log("- meta:", JSON.stringify(log.meta));

    return log;
  }

  /**
   * Validates if the actual log matches the expected log values for a specific event.
   * First gets the log string using getPodLogsWithRetry, parses it to a Log object,
   * then validates it against the expected values.
   *
   * @param eventId The id of the event to filter in the logs
   * @param message The expected log message
   * @param method The HTTP method used in the log (GET, POST, etc.)
   * @param url The URL endpoint that was hit in the log
   * @param baseURL The base URL of the application, used to get the hostname
   * @param plugin The plugin name that triggered the log event
   */
  public static async validateLogEvent(
    eventId: string,
    message: string,
    method: string,
    url: string,
    baseURL: string,
    plugin: string,
  ) {
    try {
      // Get the raw log string matching the filter
      const logString = await LogUtils.getPodLogsWithRetry(eventId);
      console.log("Raw log output:", logString);

      // Parse the log string into a structured Log object
      const parsedLog: Log = this.parseBackstageLog(logString);
      console.log("Parsed log object:", JSON.stringify(parsedLog, null, 2));

      // Create expected log object with the values to validate
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
        eventId,
      };

      console.log(
        "Validating log with expected values:",
        JSON.stringify(expectedLog, null, 2),
      );
      LogUtils.validateLog(parsedLog, expectedLog);
      console.log("Log validation successful!");
    } catch (error) {
      console.error("Error validating log event:", error);
      console.error("Event ID:", eventId);
      console.error("Expected message:", message);
      console.error("Expected method:", method);
      console.error("Expected URL:", url);
      console.error("Base URL:", baseURL);
      console.error("Plugin:", plugin);
      throw error;
    }
  }
}
