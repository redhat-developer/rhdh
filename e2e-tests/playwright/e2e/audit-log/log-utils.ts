import { execFile, exec } from "child_process";

import { type JsonObject } from "@backstage/types";
import { expect } from "@playwright/test";

import { getBackstageDeploySelector } from "../../utils/helper";
import { sleep } from "../../utils/poll-until";
import { Log, type LogRequest, type EventStatus, type EventSeverityLevel } from "./logs";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyForComparison(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function compareValues(actual: unknown, expected: unknown): void {
  if (isRecord(expected)) {
    Object.keys(expected).forEach((subKey) => {
      const expectedSubValue = expected[subKey];
      const actualSubValue = isRecord(actual) ? actual[subKey] : undefined;
      compareValues(actualSubValue, expectedSubValue);
    });
  } else if (typeof expected === "number") {
    expect(actual).toBe(expected);
  } else if (typeof expected === "string") {
    if (actual === undefined || actual === null) {
      throw new Error(`Expected value "${expected}" but got ${String(actual)}`);
    }
    expect(stringifyForComparison(actual)).toContain(expected);
  } else {
    expect(actual).toBe(expected);
  }
}

function validateLog(actual: Record<string, unknown>, expected: Partial<Log>): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue === undefined) {
      continue;
    }
    compareValues(getLogProperty(actual, key), expectedValue);
  }
}

function getLogProperty(log: Record<string, unknown>, key: string): unknown {
  return log[key];
}

/** Parse audit log JSON without applying Log constructor defaults. */
function parseLogFromJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new TypeError("Audit log JSON must be an object");
  }
  return parsed;
}

export const LogUtils = {
  /**
   * Executes a command and returns the output as a promise.
   */
  executeCommand(command: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (stderr) {
          console.warn("stderr warning:", stderr);
        }
        resolve(stdout);
      });
    });
  },

  /**
   * Executes a command with retry logic.
   */
  async executeCommandWithRetries(
    command: string,
    args: string[] = [],
    maxRetries: number = 3,
  ): Promise<string> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(
          `Attempt ${attempt + 1}/${maxRetries}: Executing command: ${command} ${args.join(" ")}`,
        );
        const output = await LogUtils.executeCommand(command, args);
        console.log(`Command executed successfully on attempt ${attempt + 1}`);
        return output;
      } catch (error) {
        console.error(`Error executing command on attempt ${attempt + 1}:`, error);
        attempt++;
      }
    }

    throw new Error(
      `Failed to execute command "${command} ${args.join(" ")}" after ${maxRetries} attempts.`,
    );
  },

  /**
   * Executes a shell command and returns the output as a promise.
   */
  executeShellCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (stderr) {
          console.warn("stderr warning:", stderr);
        }
        resolve(stdout);
      });
    });
  },

  validateLog,

  /**
   * Lists all pods in the specified namespace and returns their details.
   */
  async listPods(namespace: string): Promise<string> {
    const args = ["get", "pods", "-n", namespace, "-o", "wide"];
    try {
      console.log("Fetching pod list with command:", "oc", args.join(" "));
      return await LogUtils.executeCommand("oc", args);
    } catch (error) {
      console.error("Error listing pods:", error);
      throw new Error(`Failed to list pods in namespace "${namespace}": ${formatError(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Fetches detailed information about a specific pod.
   */
  async getPodDetails(podName: string, namespace: string): Promise<string> {
    const args = ["get", "pod", podName, "-n", namespace, "-o", "json"];
    try {
      const output = await LogUtils.executeCommand("oc", args);
      console.log(`Details for pod ${podName}:`, output);
      return output;
    } catch (error) {
      console.error(`Error fetching details for pod ${podName}:`, error);
      throw new Error(`Failed to fetch pod details: ${formatError(error)}`, {
        cause: error,
      });
    }
  },

  /**
   * Fetches logs using grep for filtering directly in the shell.
   */
  async getPodLogsWithGrep(
    filterWords: string[] = [],
    namespace: string = process.env.NAME_SPACE ?? "showcase-ci-nightly",
    maxRetries: number = 4,
    retryDelay: number = 2000,
  ): Promise<string> {
    const deploySelector = getBackstageDeploySelector();
    const tailNumber = 500;

    const deployTarget = `$(oc get deploy -n ${namespace} -l ${deploySelector} -o name)`;
    let grepCommand = `oc logs ${deployTarget} --tail=${tailNumber} -c backstage-backend -n ${namespace}`;
    for (const word of filterWords) {
      grepCommand += ` | grep '${word}'`;
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(`Attempt ${attempt + 1}/${maxRetries + 1}: Fetching logs with grep...`);
        const output = await LogUtils.executeShellCommand(grepCommand);

        const logLines = output.split("\n").filter((line) => line.trim() !== "");
        if (logLines.length > 0) {
          console.log("Matching log line found:", logLines[0]);
          return logLines[0];
        }

        console.warn(
          `No matching logs found for filter ${JSON.stringify(filterWords)} on attempt ${attempt + 1}. Retrying...`,
        );
      } catch (error) {
        console.error(`Error fetching logs on attempt ${attempt + 1}:`, formatError(error));
      }

      attempt++;
      if (attempt <= maxRetries) {
        console.log(`Waiting ${retryDelay / 1000} seconds before retrying...`);
        await sleep(retryDelay);
      }
    }

    throw new Error(
      `Failed to fetch logs for filter ${JSON.stringify(filterWords)} after ${maxRetries + 1} attempts.`,
    );
  },

  /**
   * Logs in to OpenShift using a token and server URL.
   */
  async loginToOpenShift(): Promise<void> {
    const token = process.env.K8S_CLUSTER_TOKEN ?? "";
    const server = process.env.K8S_CLUSTER_URL ?? "";

    if (token === "" || server === "") {
      throw new Error("Environment variables K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL must be set.");
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
      throw new Error(`Failed to login to OpenShift`, { cause: error });
    }
  },

  /**
   * Validates if the actual log matches the expected log values for a specific event.
   */
  async validateLogEvent(
    eventId: string,
    actorId: string,
    request?: LogRequest,
    meta?: JsonObject,
    error?: string,
    status: EventStatus = "succeeded",
    plugin: string = "catalog",
    severityLevel: EventSeverityLevel = "medium",
    filterWords: string[] = [],
    namespace: string = process.env.NAME_SPACE ?? "showcase-ci-nightly",
  ): Promise<void> {
    const filterWordsAll = [eventId, status, ...filterWords];
    if (request?.method !== undefined && request.method !== "") {
      filterWordsAll.push(request.method);
    }
    if (request?.url !== undefined && request.url !== "") {
      filterWordsAll.push(request.url);
    }
    try {
      const actualLog = await LogUtils.getPodLogsWithGrep(filterWordsAll, namespace);

      let parsedLog: Record<string, unknown>;
      try {
        parsedLog = parseLogFromJson(actualLog);
      } catch (parseError) {
        console.error("Failed to parse log JSON. Log content:", actualLog);
        throw new Error(`Invalid JSON received for log: ${formatError(parseError)}`, {
          cause: parseError,
        });
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
      validateLog(parsedLog, expectedLog);
    } catch (validationError) {
      console.error("Error validating log event:", validationError);
      console.error("Event id:", eventId);
      console.error("Actor id:", actorId);
      console.error("Meta:", meta);
      console.error("Expected method:", request?.method);
      console.error("Expected URL:", request?.url);
      console.error("Plugin:", plugin);
      throw validationError;
    }
  },
};
