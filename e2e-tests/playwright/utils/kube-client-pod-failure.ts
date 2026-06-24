import * as k8s from "@kubernetes/client-node";

import { getKubeApiErrorMessage, PodFailureResult, podNameOrUnknown } from "./kube-client-helpers";

const POD_READY_ERROR_REASONS = [
  "Unhealthy",
  "ReadinessGatesNotReady",
  "PodHasNoResources",
] as const;

const CONTAINER_FAILURE_STATES = [
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
  "ErrImageNeverPull",
  "RegistryUnavailable",
] as const;

function isTransientPvcSchedulingMessage(message: string): boolean {
  return message.includes("ephemeral volume") || message.includes("persistentvolumeclaim");
}

function checkFailedPodPhase(pod: k8s.V1Pod): PodFailureResult | null {
  const podName = podNameOrUnknown(pod.metadata?.name);
  if (pod.status?.phase !== "Failed") {
    return null;
  }

  const reason = pod.status.reason ?? "Unknown";
  const message = pod.status.message ?? "";
  return {
    message: `Pod ${podName} is in Failed phase: ${reason} - ${message}`,
  };
}

function checkPodScheduledCondition(
  pod: k8s.V1Pod,
  condition: k8s.V1PodCondition,
): PodFailureResult | null {
  const podName = podNameOrUnknown(pod.metadata?.name);
  const msg = condition.message ?? "";
  if (isTransientPvcSchedulingMessage(msg)) {
    console.log(
      `Pod ${podName} waiting for PVC creation (transient): ${condition.reason} - ${msg}`,
    );
    return null;
  }

  return {
    message: `Pod ${podName} cannot be scheduled: ${condition.reason} - ${msg}`,
  };
}

function checkPodReadyCondition(
  pod: k8s.V1Pod,
  condition: k8s.V1PodCondition,
): PodFailureResult | null {
  const reason = condition.reason;
  if (reason === undefined || reason === "" || reason === "ContainersNotReady") {
    return null;
  }

  if (!(POD_READY_ERROR_REASONS as readonly string[]).includes(reason)) {
    return null;
  }

  const podName = podNameOrUnknown(pod.metadata?.name);
  return {
    message: `Pod ${podName} is not ready: ${reason} - ${condition.message}`,
  };
}

function checkPodConditions(pod: k8s.V1Pod): PodFailureResult | null {
  const conditions = pod.status?.conditions ?? [];
  for (const condition of conditions) {
    if (condition.type === "PodScheduled" && condition.status === "False") {
      const result = checkPodScheduledCondition(pod, condition);
      if (result !== null) {
        return result;
      }
      return null;
    }

    if (condition.type === "Ready" && condition.status === "False") {
      const result = checkPodReadyCondition(pod, condition);
      if (result !== null) {
        return result;
      }
    }
  }
  return null;
}

function checkWaitingContainerState(
  pod: k8s.V1Pod,
  containerStatus: k8s.V1ContainerStatus,
  waiting: k8s.V1ContainerStateWaiting,
): PodFailureResult | null {
  const podName = podNameOrUnknown(pod.metadata?.name);
  const containerName = containerStatus.name;
  const reason = waiting.reason ?? "";

  if (!(CONTAINER_FAILURE_STATES as readonly string[]).includes(reason)) {
    const message = waiting.message ?? "";
    return {
      message: `Pod ${podName} container ${containerName} is in ${reason} state: ${message}`,
      containerName,
    };
  }

  if (reason === "ContainerCreating" && waiting.message !== undefined && waiting.message !== "") {
    console.log(`Pod ${podName} container ${containerName} is being created: ${waiting.message}`);
  }

  return null;
}

function checkTerminatedContainerState(
  pod: k8s.V1Pod,
  containerStatus: k8s.V1ContainerStatus,
  terminated: k8s.V1ContainerStateTerminated,
): PodFailureResult | null {
  if (terminated.exitCode === 0) {
    return null;
  }

  const podName = podNameOrUnknown(pod.metadata?.name);
  const containerName = containerStatus.name;
  const reason = terminated.reason ?? "Error";
  const message = terminated.message ?? "";
  return {
    message: `Pod ${podName} container ${containerName} terminated with exit code ${terminated.exitCode}: ${reason} - ${message}`,
    containerName,
  };
}

function checkContainerStatuses(pod: k8s.V1Pod): PodFailureResult | null {
  const containerStatuses = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ];

  for (const containerStatus of containerStatuses) {
    const waiting = containerStatus.state?.waiting;
    if (waiting !== undefined) {
      const waitingResult = checkWaitingContainerState(pod, containerStatus, waiting);
      if (waitingResult !== null) {
        return waitingResult;
      }
    }

    const terminated = containerStatus.state?.terminated;
    if (terminated !== undefined) {
      const terminatedResult = checkTerminatedContainerState(pod, containerStatus, terminated);
      if (terminatedResult !== null) {
        return terminatedResult;
      }
    }
  }

  return null;
}

function checkSinglePodFailure(pod: k8s.V1Pod): PodFailureResult | null {
  return checkFailedPodPhase(pod) ?? checkPodConditions(pod) ?? checkContainerStatuses(pod);
}

export async function checkPodFailureStatesImpl(
  coreV1Api: k8s.CoreV1Api,
  namespace: string,
  labelSelector: string,
): Promise<PodFailureResult | null> {
  try {
    const response = await coreV1Api.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector,
    );

    const pods = response.body.items;
    if (pods.length === 0) {
      return null;
    }

    for (const pod of pods) {
      const failure = checkSinglePodFailure(pod);
      if (failure !== null) {
        return failure;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error checking pod failure states: ${getKubeApiErrorMessage(error)}`);
    return null;
  }
}
