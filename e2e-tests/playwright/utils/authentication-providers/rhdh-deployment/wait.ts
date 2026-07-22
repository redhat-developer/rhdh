import * as k8s from "@kubernetes/client-node";

import { getErrorMessage, hasErrorResponse } from "../../errors";
import { pollUntil, pollUntilStable } from "../../poll-until";
import { BackstageCr, RHDHDeploymentState } from "./types";

const BACKSTAGE_LABELS = {
  "app.kubernetes.io/name": "backstage",
} as const;

const POLL_INTERVAL_MS = 500;

function skipIfRunningLocal(state: RHDHDeploymentState, message?: string): boolean {
  if (state.isRunningLocal) {
    if (message !== undefined && message !== "") {
      console.log(message);
    }
    return true;
  }
  return false;
}

function buildLabelSelector(instanceName: string): string {
  const labels = {
    ...BACKSTAGE_LABELS,
    "app.kubernetes.io/instance": instanceName,
  };
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

async function getLabeledDeployment(
  state: RHDHDeploymentState,
  labelSelector: string,
): Promise<k8s.V1Deployment> {
  const deployments = await state.appsV1Api.listNamespacedDeployment(
    state.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    labelSelector,
  );

  if (deployments.body.items.length === 0) {
    throw new Error(`No deployment found with labels: ${labelSelector}`);
  }

  return deployments.body.items[0];
}

export async function getDeploymentGeneration(state: RHDHDeploymentState): Promise<number> {
  const labelSelector = buildLabelSelector(state.instanceName);
  const deployment = await getLabeledDeployment(state, labelSelector);
  return deployment.metadata?.generation ?? 0;
}

export async function waitForConfigReconciled(
  state: RHDHDeploymentState,
  timeoutMs: number = 60000,
): Promise<void> {
  if (skipIfRunningLocal(state)) {
    return;
  }

  const baseline =
    state.configReconcileBaselineGeneration ?? (await getDeploymentGeneration(state));

  try {
    await pollUntil(async () => (await getDeploymentGeneration(state)) > baseline, {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      label: `Config reconcile (generation > ${baseline})`,
    });
    console.log(`[INFO] Config reconciled - deployment generation > ${baseline}`);
  } catch {
    console.log(`[INFO] No deployment generation change after ${timeoutMs}ms, proceeding`);
  }
}

function hasRolloutStarted(
  initialGeneration: number,
  currentGeneration: number,
  observedGeneration: number,
  isProgressing: boolean,
): boolean {
  return (
    currentGeneration > initialGeneration || observedGeneration < currentGeneration || isProgressing
  );
}

function isDeploymentAvailable(conditions: k8s.V1DeploymentCondition[]): boolean {
  return conditions.some(
    (condition) => condition.type === "Available" && condition.status === "True",
  );
}

function isDeploymentProgressingWithRollout(conditions: k8s.V1DeploymentCondition[]): boolean {
  return conditions.some(
    (condition) =>
      condition.type === "Progressing" &&
      condition.status === "True" &&
      condition.reason !== "NewReplicaSetAvailable",
  );
}

function deploymentReplicasMatch(deployment: k8s.V1Deployment, desiredReplicas: number): boolean {
  const availableReplicas = deployment.status?.availableReplicas ?? 0;
  const readyReplicas = deployment.status?.readyReplicas ?? 0;
  const updatedReplicas = deployment.status?.updatedReplicas ?? 0;

  return (
    availableReplicas === desiredReplicas &&
    readyReplicas === desiredReplicas &&
    updatedReplicas === desiredReplicas
  );
}

function isDeploymentReady(deployment: k8s.V1Deployment, cr: BackstageCr): boolean {
  const conditions = deployment.status?.conditions ?? [];
  const currentGeneration = deployment.metadata?.generation ?? 0;
  const observedGeneration = deployment.status?.observedGeneration ?? 0;
  const desiredReplicas = cr.spec.replicas ?? 1;
  const replicas = deployment.spec?.replicas;

  return (
    isDeploymentAvailable(conditions) &&
    !isDeploymentProgressingWithRollout(conditions) &&
    replicas === desiredReplicas &&
    deploymentReplicasMatch(deployment, desiredReplicas) &&
    observedGeneration >= currentGeneration
  );
}

async function waitForRolloutStart(
  state: RHDHDeploymentState,
  labelSelector: string,
  rolloutStartTimeout: number,
): Promise<{ rolloutStarted: boolean; initialGeneration: number }> {
  let initialGeneration = 0;

  try {
    await pollUntil(
      async () => {
        const deployment = await getLabeledDeployment(state, labelSelector);

        if (initialGeneration === 0) {
          initialGeneration = deployment.metadata?.generation ?? 0;
          console.log(`[INFO] Initial deployment generation: ${initialGeneration}`);
        }

        const currentGeneration = deployment.metadata?.generation ?? 0;
        const observedGeneration = deployment.status?.observedGeneration ?? 0;
        const isProgressing = (deployment.status?.conditions ?? []).some(
          (condition) => condition.type === "Progressing" && condition.status === "True",
        );

        return hasRolloutStarted(
          initialGeneration,
          currentGeneration,
          observedGeneration,
          isProgressing,
        );
      },
      {
        timeoutMs: rolloutStartTimeout,
        intervalMs: POLL_INTERVAL_MS,
        label: "Deployment rollout start",
      },
    );

    console.log("[INFO] Rollout detected");
    return { rolloutStarted: true, initialGeneration };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Deployment rollout start")) {
      console.log(
        `[INFO] No rollout detected after ${rolloutStartTimeout}ms, checking if deployment is already ready`,
      );
      return { rolloutStarted: true, initialGeneration };
    }
    throw error;
  }
}

async function pollDeploymentReady(
  state: RHDHDeploymentState,
  labelSelector: string,
  timeoutMs: number,
): Promise<void> {
  const rolloutStartTimeout = 60_000;
  await waitForRolloutStart(state, labelSelector, rolloutStartTimeout);

  await pollUntilStable(
    async () => {
      try {
        const deployment = await getLabeledDeployment(state, labelSelector);
        return isDeploymentReady(deployment, state.cr);
      } catch (error) {
        console.log(`[INFO] Deployment readiness check failed: ${getErrorMessage(error)}`);
        return false;
      }
    },
    {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      stableChecks: 2,
      label: `Deployment ready (${labelSelector})`,
    },
  );
}

export async function waitForDeploymentReady(
  state: RHDHDeploymentState,
  timeoutMs: number = 600000,
): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping deployment ready check as isRunningLocal is true.")) {
    return;
  }

  const labelSelector = buildLabelSelector(state.instanceName);
  await pollDeploymentReady(state, labelSelector, timeoutMs);
}

export async function waitForNamespaceActive(
  state: RHDHDeploymentState,
  timeoutMs: number = 30000,
): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping namespace active check as isRunningLocal is true.")) {
    return;
  }

  await pollUntil(
    async () => {
      try {
        const response = await state.k8sApi.readNamespace(state.namespace);
        return response.body.status?.phase === "Active";
      } catch {
        return false;
      }
    },
    {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      label: `Namespace ${state.namespace} active`,
    },
  );
}

export async function ensureBackstageCRIsAvailable(
  state: RHDHDeploymentState,
  timeoutMs: number = 60000,
): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping CRD check as isRunningLocal is true.")) {
    return;
  }

  await pollUntil(
    async () => {
      try {
        const customObjectsApi = state.kc.makeApiClient(k8s.CustomObjectsApi);
        await customObjectsApi.getClusterCustomObject(
          "apiextensions.k8s.io",
          "v1",
          "customresourcedefinitions",
          "backstages.rhdh.redhat.com",
        );
        return true;
      } catch (error) {
        console.log(`Waiting for Backstage CRD: ${getErrorMessage(error)}`);
        return false;
      }
    },
    {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      label: "Backstage CRD available",
    },
  );
}

export async function deleteNamespaceIfExists(
  state: RHDHDeploymentState,
  timeoutMs: number = 60000,
): Promise<void> {
  if (skipIfRunningLocal(state, "Skipping namespace deletion as isRunningLocal is true.")) {
    return;
  }

  try {
    await state.k8sApi.deleteNamespace(state.namespace);

    await pollUntil(
      async () => {
        try {
          await state.k8sApi.readNamespace(state.namespace);
          return false;
        } catch (error) {
          if (hasErrorResponse(error) && error.response?.statusCode === 404) {
            return true;
          }
          throw error;
        }
      },
      {
        timeoutMs,
        intervalMs: POLL_INTERVAL_MS,
        label: `Namespace ${state.namespace} deleted`,
      },
    );
  } catch (e) {
    if (hasErrorResponse(e) && e.response?.statusCode === 404) {
      return;
    }
    throw e;
  }
}
