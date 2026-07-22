import * as k8s from "@kubernetes/client-node";

import {
  DEFAULT_BACKSTAGE_LABEL_SELECTOR,
  formatContainerStartedAt,
  getKubeApiErrorMessage,
  podNameOrUnknown,
} from "../helpers";

function logWaitingContainerStatus(
  containerName: string,
  waiting: k8s.V1ContainerStateWaiting,
): void {
  console.log(`  ${containerName}: Waiting - ${waiting.reason}: ${waiting.message}`);
}

function logRunningContainerStatus(
  containerName: string,
  running: k8s.V1ContainerStateRunning,
): void {
  console.log(
    `  ${containerName}: Running (started: ${formatContainerStartedAt(running.startedAt)})`,
  );
}

function logTerminatedContainerStatus(
  containerName: string,
  terminated: k8s.V1ContainerStateTerminated,
): void {
  console.log(
    `  ${containerName}: Terminated - Exit Code: ${terminated.exitCode}, Reason: ${terminated.reason}`,
  );
  if (terminated.message !== undefined && terminated.message !== "") {
    console.log(`    Message: ${terminated.message}`);
  }
}

function logSingleContainerStatus(containerStatus: k8s.V1ContainerStatus): void {
  const containerName = containerStatus.name;
  const waiting = containerStatus.state?.waiting;
  const running = containerStatus.state?.running;
  const terminated = containerStatus.state?.terminated;

  if (waiting !== undefined) {
    logWaitingContainerStatus(containerName, waiting);
    return;
  }
  if (running !== undefined) {
    logRunningContainerStatus(containerName, running);
    return;
  }
  if (terminated !== undefined) {
    logTerminatedContainerStatus(containerName, terminated);
  }
}

function logPodContainerStatuses(pod: k8s.V1Pod): void {
  const containerStatuses = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ];

  if (containerStatuses.length === 0) {
    return;
  }

  console.log("Container Statuses:");
  for (const containerStatus of containerStatuses) {
    logSingleContainerStatus(containerStatus);
  }
}

export async function logPodConditionsImpl(
  coreV1Api: k8s.CoreV1Api,
  namespace: string,
  labelSelector: string,
): Promise<void> {
  try {
    const response = await coreV1Api.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector,
    );

    if (response.body.items.length === 0) {
      console.warn(`No pods found for selector: ${labelSelector}`);
    }

    for (const pod of response.body.items) {
      const podName = podNameOrUnknown(pod.metadata?.name);
      const phase = pod.status?.phase;
      console.log(`Pod: ${podName} (Phase: ${phase})`);
      console.log("Conditions:", JSON.stringify(pod.status?.conditions, null, 2));
      logPodContainerStatuses(pod);
    }
  } catch (error) {
    console.error(
      `Error while retrieving pod conditions for selector '${labelSelector}': ${getKubeApiErrorMessage(error)}`,
    );
  }
}

async function readContainerLogs(
  coreV1Api: k8s.CoreV1Api,
  podName: string,
  namespace: string,
  containerName: string,
): Promise<void> {
  console.log(`\n=== Pod ${podName} - Container ${containerName} Logs (last 100 lines) ===`);
  const logs = await coreV1Api.readNamespacedPodLog(
    podName,
    namespace,
    containerName,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    100,
  );

  if (logs.body !== undefined && logs.body !== "") {
    const logLines = logs.body.split("\n");
    logLines.forEach((line) => {
      if (line.trim() !== "") {
        console.log(line);
      }
    });
    return;
  }

  console.log("(No logs available)");
}

function resolvePodContainers(pod: k8s.V1Pod, containerName?: string): Array<{ name: string }> {
  if (containerName !== undefined && containerName !== "") {
    return [{ name: containerName }];
  }

  return [...(pod.spec?.initContainers ?? []), ...(pod.spec?.containers ?? [])];
}

export async function logPodContainerLogsImpl(
  coreV1Api: k8s.CoreV1Api,
  namespace: string,
  labelSelector?: string,
  containerName?: string,
): Promise<void> {
  const selector = labelSelector ?? DEFAULT_BACKSTAGE_LABEL_SELECTOR;

  try {
    const podsResponse = await coreV1Api.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      selector,
    );

    if (podsResponse.body.items.length === 0) {
      console.log("No pods found to retrieve logs from.");
      return;
    }

    for (const pod of podsResponse.body.items.slice(0, 2)) {
      const podName = pod.metadata?.name;
      if (podName === undefined || podName === "") {
        continue;
      }

      const containers = resolvePodContainers(pod, containerName);
      for (const container of containers) {
        const cn = container.name;
        try {
          await readContainerLogs(coreV1Api, podName, namespace, cn);
        } catch (logError) {
          const errorMsg = getKubeApiErrorMessage(logError);
          console.warn(`Could not retrieve logs for pod ${podName} container ${cn}: ${errorMsg}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error retrieving pod logs: ${getKubeApiErrorMessage(error)}`);
  }
}

export async function logPodConditionsForDeploymentImpl(
  logPodConditions: (namespace: string, labelSelector: string) => Promise<void>,
  getDeploymentPodSelector: (deploymentName: string, namespace: string) => Promise<string>,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  try {
    const selector = await getDeploymentPodSelector(deploymentName, namespace);
    await logPodConditions(namespace, selector);
  } catch (error) {
    console.warn(
      `Could not resolve pod selector for deployment '${deploymentName}': ${getKubeApiErrorMessage(error)}`,
    );
  }
}
