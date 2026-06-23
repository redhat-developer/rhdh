import * as k8s from "@kubernetes/client-node";
import {
  getErrorStatusCode,
  getKubeApiErrorMessage,
  sleep,
} from "./kube-client-helpers";

export async function getDeploymentPodSelectorImpl(
  appsApi: k8s.AppsV1Api,
  deploymentName: string,
  namespace: string,
): Promise<string> {
  const response = await appsApi.readNamespacedDeployment(
    deploymentName,
    namespace,
  );
  const matchLabels = response.body.spec?.selector?.matchLabels ?? {};
  const entries = Object.entries(matchLabels);
  if (entries.length === 0) {
    throw new Error(
      `Deployment '${deploymentName}' in namespace '${namespace}' has no matchLabels in selector`,
    );
  }
  return entries.map(([k, v]) => `${k}=${v}`).join(",");
}

async function patchDeploymentScale(
  appsApi: k8s.AppsV1Api,
  deploymentName: string,
  namespace: string,
  replicas: number,
): Promise<void> {
  const patch = { spec: { replicas } };
  await appsApi.patchNamespacedDeploymentScale(
    deploymentName,
    namespace,
    patch,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      headers: {
        "Content-Type": "application/strategic-merge-patch+json",
      },
    },
  );
}

async function handleScaleRetry(
  error: unknown,
  attempt: number,
  maxRetries: number,
  deploymentName: string,
): Promise<boolean> {
  const statusCode = getErrorStatusCode(error);
  const isRetryable =
    statusCode === 404 || statusCode === 503 || statusCode === 429;

  if (isRetryable && attempt < maxRetries) {
    const delay = attempt * 2000;
    console.log(
      `Deployment ${deploymentName} not ready (${String(statusCode)}). Retry ${attempt}/${maxRetries} after ${delay}ms...`,
    );
    await sleep(delay);
    return true;
  }

  console.error(
    `Failed to scale deployment ${deploymentName} after ${attempt} attempts:`,
    getKubeApiErrorMessage(error),
  );
  throw error;
}

export async function scaleDeploymentImpl(
  appsApi: k8s.AppsV1Api,
  deploymentName: string,
  namespace: string,
  replicas: number,
  maxRetries: number = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await patchDeploymentScale(appsApi, deploymentName, namespace, replicas);
      console.log(
        `Deployment ${deploymentName} scaled to ${replicas} replicas.`,
      );
      return;
    } catch (error) {
      const shouldRetry = await handleScaleRetry(
        error,
        attempt,
        maxRetries,
        deploymentName,
      );
      if (!shouldRetry) {
        return;
      }
    }
  }
}
