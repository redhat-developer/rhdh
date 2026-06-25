import stream from "stream";

import * as k8s from "@kubernetes/client-node";

import { getErrorMessage, hasErrorResponse } from "../../errors";
import { pollUntil } from "../../poll-until";
import { RHDHDeploymentState, syncedLogRegex } from "./types";

async function resolvePodName(
  state: RHDHDeploymentState,
  podName: string | undefined,
  podLabels: Record<string, string> | undefined,
): Promise<string> {
  if (podName !== undefined && podName !== "") {
    return podName;
  }

  if (podLabels === undefined) {
    throw new Error("Either podName or podLabels must be provided");
  }

  try {
    const labelSelector = Object.entries(podLabels)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    const pods = await state.k8sApi.listNamespacedPod(
      state.namespace,
      undefined,
      undefined,
      undefined,
      "status.phase=Running",
      labelSelector,
    );

    if (pods.body.items.length === 0) {
      throw new Error(`No pod found with labels: ${labelSelector}`);
    }

    const activePods = pods.body.items.filter((pod) => {
      const isTerminating = pod.metadata?.deletionTimestamp !== undefined;
      return !isTerminating;
    });

    if (activePods.length === 0) {
      throw new Error(`No active pods found with labels: ${labelSelector}`);
    }

    const pod = activePods[0];
    const resolvedName = pod.metadata?.name;
    if (resolvedName === undefined || resolvedName === "") {
      throw new Error(`Pod name missing for labels: ${labelSelector}`);
    }
    return resolvedName;
  } catch (error) {
    throw new Error(`Error getting pod name: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

async function streamPodLogsUntilMatch(
  state: RHDHDeploymentState,
  podName: string,
  searchString: RegExp,
  timeoutMs: number,
): Promise<boolean> {
  console.log(`Reading logs for pod ${podName}`);
  let found = false;
  const log = new k8s.Log(state.kc);
  const logStream = new stream.PassThrough();

  logStream.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    if (searchString.test(text)) {
      process.stdout.write(chunk);
      found = true;
    }
  });

  logStream.on("error", (error) => {
    throw new Error(`Error getting pod name: ${getErrorMessage(error)}`);
  });

  logStream.on("end", () => {
    console.log("Log stream ended.");
  });

  await log.log(state.namespace, podName, "backstage-backend", logStream, {
    follow: true,
    tailLines: 1,
    pretty: false,
    timestamps: false,
  });

  await pollUntil(() => Promise.resolve(found), {
    timeoutMs,
    intervalMs: 500,
    label: `Log pattern ${searchString} in pod ${podName}`,
  });

  logStream.end();
  logStream.removeAllListeners();
  return true;
}

export async function followPodLogs(
  state: RHDHDeploymentState,
  searchString: RegExp,
  podName?: string,
  podLabels?: Record<string, string>,
  timeoutMs: number = 300000,
): Promise<boolean> {
  const resolvedPodName = await resolvePodName(state, podName, podLabels);

  try {
    return await streamPodLogsUntilMatch(state, resolvedPodName, searchString, timeoutMs);
  } catch (error) {
    const message = hasErrorResponse(error) ? error.body?.message : getErrorMessage(error);
    console.log(`Error: ${message}`);
    throw new Error(
      `Timeout waiting for string "${searchString}" in logs after ${timeoutMs}ms. Error: ${message}`,
      { cause: error },
    );
  }
}

export async function followLocalLogs(
  state: RHDHDeploymentState,
  searchString: RegExp,
  timeoutMs: number = 30000,
): Promise<boolean> {
  if (!state.isRunningLocal) {
    throw new Error("Not running in local mode. Cannot follow local logs.");
  }

  let found = false;

  console.log(
    "Following logs from the local production server. Looking for string: ",
    searchString,
  );

  const logStream = new stream.PassThrough();
  state.runningProcess?.stdout?.pipe(logStream);

  logStream.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    const isLocalDebug =
      process.env.ISRUNNINGLOCAL === "true" &&
      process.env.ISRUNNINGLOCALDEBUG !== undefined &&
      process.env.ISRUNNINGLOCALDEBUG !== "";
    if (isLocalDebug) {
      console.log(`\t${text.replaceAll("\n", "\t")}`);
    }
    if (searchString.test(text)) {
      console.log("Found string in local logs.");
      found = true;
    }
  });

  logStream.on("error", (error) => {
    throw new Error(`Error reading local logs: ${getErrorMessage(error)}`);
  });

  logStream.on("end", () => {
    console.log("Local log stream ended.");
  });

  await pollUntil(() => Promise.resolve(found), {
    timeoutMs,
    intervalMs: 500,
    label: `Log pattern ${searchString} in local process output`,
  });

  return true;
}

export function followLogs(
  state: RHDHDeploymentState,
  searchString: RegExp,
  timeoutMs: number = 300000,
): Promise<boolean> {
  if (state.isRunningLocal) {
    return followLocalLogs(state, searchString, timeoutMs);
  }
  return followPodLogs(
    state,
    searchString,
    undefined,
    { "rhdh.redhat.com/app": `backstage-${state.instanceName}` },
    timeoutMs,
  );
}

export async function waitForSynced(state: RHDHDeploymentState): Promise<void> {
  const synced = await followLogs(state, syncedLogRegex, 120000);
  const { expect } = await import("@playwright/test");
  expect(synced).toBe(true);
}
