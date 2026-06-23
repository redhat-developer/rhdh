import * as k8s from "@kubernetes/client-node";
import {
  getKubeApiErrorMessage,
  PodFailureResult,
  sleep,
} from "./kube-client-helpers";

export interface DeploymentDiagnostics {
  logDeploymentEvents: (
    deploymentName: string,
    namespace: string,
  ) => Promise<void>;
  logReplicaSetStatus: (
    deploymentName: string,
    namespace: string,
  ) => Promise<void>;
  logPodEvents: (namespace: string, labelSelector: string) => Promise<void>;
  logPodConditions: (namespace: string, labelSelector: string) => Promise<void>;
  logPodContainerLogs: (
    namespace: string,
    labelSelector: string,
    containerName?: string,
  ) => Promise<void>;
}

async function handlePodFailureDuringWait(
  diagnostics: DeploymentDiagnostics,
  deploymentName: string,
  namespace: string,
  finalLabelSelector: string,
  podFailure: PodFailureResult,
): Promise<never> {
  console.error(
    `Pod failure detected: ${podFailure.message}. Logging events and pod logs...`,
  );
  await diagnostics.logDeploymentEvents(deploymentName, namespace);
  await diagnostics.logReplicaSetStatus(deploymentName, namespace);
  await diagnostics.logPodEvents(namespace, finalLabelSelector);
  await diagnostics.logPodConditions(namespace, finalLabelSelector);
  await diagnostics.logPodContainerLogs(
    namespace,
    finalLabelSelector,
    podFailure.containerName,
  );
  throw new Error(
    `Deployment ${deploymentName} failed to start: ${podFailure.message}`,
  );
}

function logDeploymentStatus(response: { body: k8s.V1Deployment }): number {
  const availableReplicas = response.body.status?.availableReplicas ?? 0;
  const readyReplicas = response.body.status?.readyReplicas ?? 0;
  const updatedReplicas = response.body.status?.updatedReplicas ?? 0;
  const replicas = response.body.status?.replicas ?? 0;
  const conditions = response.body.status?.conditions ?? [];

  console.log(`Available replicas: ${availableReplicas}`);
  console.log(`Ready replicas: ${readyReplicas}`);
  console.log(`Updated replicas: ${updatedReplicas}`);
  console.log(`Desired replicas: ${replicas}`);
  console.log("Deployment conditions:", JSON.stringify(conditions, null, 2));

  return availableReplicas;
}

async function checkDeploymentReplicaStatus(
  appsApi: k8s.AppsV1Api,
  checkPodFailureStates: (
    namespace: string,
    labelSelector: string,
  ) => Promise<PodFailureResult | null>,
  logPodConditions: (namespace: string, labelSelector: string) => Promise<void>,
  diagnostics: DeploymentDiagnostics,
  deploymentName: string,
  namespace: string,
  expectedReplicas: number,
  podSelector: string,
  finalLabelSelector: string,
): Promise<boolean> {
  const response = await appsApi.readNamespacedDeployment(
    deploymentName,
    namespace,
  );
  const availableReplicas = logDeploymentStatus(response);

  if (expectedReplicas > 0 && podSelector !== "") {
    const podFailure = await checkPodFailureStates(namespace, podSelector);
    if (podFailure !== null) {
      await handlePodFailureDuringWait(
        diagnostics,
        deploymentName,
        namespace,
        finalLabelSelector,
        podFailure,
      );
    }
  }

  await logPodConditions(namespace, podSelector);

  if (availableReplicas === expectedReplicas) {
    console.log(
      `Deployment ${deploymentName} is ready with ${availableReplicas} replicas.`,
    );
    return true;
  }

  return false;
}

function isPodStartupFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes("failed to start");
}

async function logDeploymentWaitProgress(
  appsApi: k8s.AppsV1Api,
  deploymentName: string,
  namespace: string,
  expectedReplicas: number,
): Promise<void> {
  const response = await appsApi.readNamespacedDeployment(
    deploymentName,
    namespace,
  );
  const readyReplicas = response.body.status?.readyReplicas ?? 0;
  console.log(
    `Waiting for ${deploymentName} to become ready (${readyReplicas}/${expectedReplicas} ready)...`,
  );
}

async function logDeploymentTimeoutDiagnostics(
  diagnostics: DeploymentDiagnostics,
  deploymentName: string,
  namespace: string,
  finalLabelSelector: string,
): Promise<void> {
  console.error(
    `Timeout waiting for deployment ${deploymentName}. Collecting diagnostics...`,
  );
  await diagnostics.logDeploymentEvents(deploymentName, namespace);
  await diagnostics.logReplicaSetStatus(deploymentName, namespace);
  await diagnostics.logPodEvents(namespace, finalLabelSelector);
  await diagnostics.logPodConditions(namespace, finalLabelSelector);
}

export async function waitForDeploymentReadyImpl(
  appsApi: k8s.AppsV1Api,
  getDeploymentPodSelector: (
    deploymentName: string,
    namespace: string,
  ) => Promise<string>,
  checkPodFailureStates: (
    namespace: string,
    labelSelector: string,
  ) => Promise<PodFailureResult | null>,
  logPodConditions: (namespace: string, labelSelector: string) => Promise<void>,
  diagnostics: DeploymentDiagnostics,
  deploymentName: string,
  namespace: string,
  expectedReplicas: number,
  timeout: number = 300000,
  checkInterval: number = 10000,
  labelSelector?: string,
): Promise<void> {
  const endTime = Date.now() + timeout;
  const podSelector = await getDeploymentPodSelector(deploymentName, namespace);
  const finalLabelSelector = labelSelector ?? podSelector;
  const progressLogStart = endTime - timeout + checkInterval * 2;

  while (Date.now() < endTime) {
    try {
      const isReady = await checkDeploymentReplicaStatus(
        appsApi,
        checkPodFailureStates,
        logPodConditions,
        diagnostics,
        deploymentName,
        namespace,
        expectedReplicas,
        podSelector,
        finalLabelSelector,
      );
      if (isReady) {
        return;
      }

      if (Date.now() > progressLogStart) {
        await logDeploymentWaitProgress(
          appsApi,
          deploymentName,
          namespace,
          expectedReplicas,
        );
      }
    } catch (error) {
      console.error(
        `Error checking deployment status: ${getKubeApiErrorMessage(error)}`,
      );
      if (isPodStartupFailure(error)) {
        throw error;
      }
    }

    await sleep(checkInterval);
  }

  await logDeploymentTimeoutDiagnostics(
    diagnostics,
    deploymentName,
    namespace,
    finalLabelSelector,
  );
  throw new Error(
    `Deployment ${deploymentName} did not become ready in time (timeout: ${timeout / 1000}s).`,
  );
}
