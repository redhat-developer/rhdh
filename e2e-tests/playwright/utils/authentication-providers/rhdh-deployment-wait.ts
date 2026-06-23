import * as k8s from "@kubernetes/client-node";
import { getErrorMessage, hasErrorResponse } from "../errors";
import {
  BackstageCr,
  RHDHDeploymentState,
  sleep,
} from "./rhdh-deployment-types";

const BACKSTAGE_LABELS = {
  "app.kubernetes.io/name": "backstage",
} as const;

function buildLabelSelector(instanceName: string): string {
  const labels = {
    ...BACKSTAGE_LABELS,
    "app.kubernetes.io/instance": instanceName,
  };
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

export async function getDeploymentGeneration(
  state: RHDHDeploymentState,
): Promise<number> {
  const labelSelector = buildLabelSelector(state.instanceName);

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

  return deployments.body.items[0].metadata?.generation ?? 0;
}

export async function waitForConfigReconciled(
  state: RHDHDeploymentState,
  timeoutMs: number = 60000,
): Promise<void> {
  if (state.isRunningLocal) {
    return;
  }

  const baseline =
    state.configReconcileBaselineGeneration ??
    (await getDeploymentGeneration(state));
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const currentGeneration = await getDeploymentGeneration(state);
    if (currentGeneration > baseline) {
      console.log(
        `[INFO] Config reconciled - deployment generation ${baseline} -> ${currentGeneration}`,
      );
      return;
    }
    await sleep(1000);
  }

  console.log(
    `[INFO] No deployment generation change after ${timeoutMs}ms, proceeding`,
  );
}

function hasRolloutStarted(
  initialGeneration: number,
  currentGeneration: number,
  observedGeneration: number,
  isProgressing: boolean,
): boolean {
  return (
    currentGeneration > initialGeneration ||
    observedGeneration < currentGeneration ||
    isProgressing
  );
}

function isDeploymentReady(
  deployment: k8s.V1Deployment,
  cr: BackstageCr,
): boolean {
  const conditions = deployment.status?.conditions ?? [];
  const currentGeneration = deployment.metadata?.generation ?? 0;
  const observedGeneration = deployment.status?.observedGeneration ?? 0;

  const isAvailable = conditions.some(
    (condition) =>
      condition.type === "Available" && condition.status === "True",
  );

  const isProgressingWithRollout = conditions.some(
    (condition) =>
      condition.type === "Progressing" &&
      condition.status === "True" &&
      condition.reason !== "NewReplicaSetAvailable",
  );

  const replicas = deployment.spec?.replicas;
  const desiredReplicas = cr.spec.replicas ?? 1;
  const availableReplicas = deployment.status?.availableReplicas ?? 0;
  const readyReplicas = deployment.status?.readyReplicas ?? 0;
  const updatedReplicas = deployment.status?.updatedReplicas ?? 0;

  const replicasMatch =
    availableReplicas === desiredReplicas &&
    readyReplicas === desiredReplicas &&
    updatedReplicas === desiredReplicas;

  return (
    isAvailable &&
    !isProgressingWithRollout &&
    replicas === desiredReplicas &&
    replicasMatch &&
    observedGeneration >= currentGeneration
  );
}

async function waitForRolloutStart(
  state: RHDHDeploymentState,
  labelSelector: string,
  rolloutStartTimeout: number,
  startTime: number,
): Promise<{ rolloutStarted: boolean; initialGeneration: number }> {
  let initialGeneration = 0;
  let rolloutStarted = false;

  while (Date.now() - startTime < rolloutStartTimeout) {
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

    const deployment = deployments.body.items[0];
    const conditions = deployment.status?.conditions ?? [];

    if (initialGeneration === 0) {
      initialGeneration = deployment.metadata?.generation ?? 0;
      console.log(`[INFO] Initial deployment generation: ${initialGeneration}`);
    }

    const currentGeneration = deployment.metadata?.generation ?? 0;
    const observedGeneration = deployment.status?.observedGeneration ?? 0;
    const isProgressing = conditions.some(
      (condition) =>
        condition.type === "Progressing" && condition.status === "True",
    );

    if (
      hasRolloutStarted(
        initialGeneration,
        currentGeneration,
        observedGeneration,
        isProgressing,
      )
    ) {
      rolloutStarted = true;
      console.log(
        `[INFO] Rollout detected - Generation: ${currentGeneration}, Observed: ${observedGeneration}`,
      );
      return { rolloutStarted, initialGeneration };
    }

    const elapsedSinceStart = Date.now() - startTime;
    console.log(
      `[INFO] Waiting for rollout to start... (${Math.round(elapsedSinceStart / 1000)}s elapsed)`,
    );
    await sleep(2000);
  }

  console.log(
    `[INFO] No rollout detected after ${rolloutStartTimeout}ms, checking if deployment is already ready`,
  );
  return { rolloutStarted: true, initialGeneration };
}

async function pollDeploymentReady(
  state: RHDHDeploymentState,
  labelSelector: string,
  timeoutMs: number,
  startTime: number,
): Promise<void> {
  const rolloutStartTimeout = 60000;
  const { rolloutStarted } = await waitForRolloutStart(
    state,
    labelSelector,
    rolloutStartTimeout,
    startTime,
  );

  if (!rolloutStarted) {
    throw new Error("Rollout did not start within timeout");
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
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

      const deployment = deployments.body.items[0];

      if (isDeploymentReady(deployment, state.cr)) {
        await sleep(5000);
        return;
      }

      const desiredReplicas = state.cr.spec.replicas ?? 1;
      const availableReplicas = deployment.status?.availableReplicas ?? 0;
      const readyReplicas = deployment.status?.readyReplicas ?? 0;
      const updatedReplicas = deployment.status?.updatedReplicas ?? 0;
      const observedGeneration = deployment.status?.observedGeneration ?? 0;
      const currentGeneration = deployment.metadata?.generation ?? 0;

      console.log(
        `[INFO] Deployment is progressing - Available: ${availableReplicas}, Ready: ${readyReplicas}, Updated: ${updatedReplicas}, Desired: ${desiredReplicas}, Observed Gen: ${observedGeneration}/${currentGeneration}`,
      );

      await sleep(5000);
    } catch (error) {
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(
          `Timeout waiting for deployment to be ready: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }
      await sleep(5000);
    }
  }

  throw new Error(
    `Timeout waiting for deployment to be ready after ${timeoutMs}ms`,
  );
}

export async function waitForDeploymentReady(
  state: RHDHDeploymentState,
  timeoutMs: number = 600000,
): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping deployment ready check as isRunningLocal is true.");
    return;
  }

  const labelSelector = buildLabelSelector(state.instanceName);
  const startTime = Date.now();
  await pollDeploymentReady(state, labelSelector, timeoutMs, startTime);
}

export async function waitForNamespaceActive(
  state: RHDHDeploymentState,
  timeoutMs: number = 30000,
): Promise<void> {
  const startTime = Date.now();
  if (state.isRunningLocal) {
    console.log("Skipping namespace active check as isRunningLocal is true.");
    return;
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await state.k8sApi.readNamespace(state.namespace);
      const phase = response.body.status?.phase;

      if (phase === "Active") {
        return;
      }

      await sleep(1000);
    } catch (error) {
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(
          `Timeout waiting for namespace to be active: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }
      await sleep(1000);
    }
  }

  throw new Error(
    `Timeout waiting for namespace to be active after ${timeoutMs}ms`,
  );
}

export async function ensureBackstageCRIsAvailable(
  state: RHDHDeploymentState,
  timeoutMs: number = 60000,
): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping CRD check as isRunningLocal is true.");
    return;
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const customObjectsApi = state.kc.makeApiClient(k8s.CustomObjectsApi);
      await customObjectsApi.getClusterCustomObject(
        "apiextensions.k8s.io",
        "v1",
        "customresourcedefinitions",
        "backstages.rhdh.redhat.com",
      );
      return;
    } catch (error) {
      console.log(
        `Timeout waiting for Backstage CRD to be available: ${getErrorMessage(error)}`,
      );
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(
          `Timeout waiting for Backstage CRD to be available: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }
      await sleep(5000);
    }
  }
  throw new Error(
    `Timeout waiting for Backstage CRD to be available after ${timeoutMs}ms`,
  );
}

export async function deleteNamespaceIfExists(
  state: RHDHDeploymentState,
  timeoutMs: number = 60000,
): Promise<void> {
  if (state.isRunningLocal) {
    console.log("Skipping namespace deletion as isRunningLocal is true.");
    return;
  }

  try {
    await state.k8sApi.deleteNamespace(state.namespace);

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        await state.k8sApi.readNamespace(state.namespace);
        await sleep(1000);
      } catch (error) {
        if (hasErrorResponse(error) && error.response?.statusCode === 404) {
          return;
        }
        throw error;
      }
    }
    throw new Error(
      `Timeout waiting for namespace to be deleted after ${timeoutMs}ms`,
    );
  } catch (e) {
    if (hasErrorResponse(e) && e.response?.statusCode === 404) {
      return;
    }
    throw e;
  }
}
