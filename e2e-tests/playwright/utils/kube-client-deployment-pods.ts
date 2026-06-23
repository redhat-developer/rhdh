import * as k8s from "@kubernetes/client-node";
import { pollUntil } from "./poll-until";

export async function waitForPodsTerminatedImpl(
  coreV1Api: k8s.CoreV1Api,
  getDeploymentPodSelector: (
    deploymentName: string,
    namespace: string,
  ) => Promise<string>,
  deploymentName: string,
  namespace: string,
  timeoutMs = 120_000,
): Promise<void> {
  const labelSelector = await getDeploymentPodSelector(
    deploymentName,
    namespace,
  );

  await pollUntil(
    async () => {
      const response = await coreV1Api.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector,
      );
      const activePods = response.body.items.filter(
        (pod) => pod.metadata?.deletionTimestamp === undefined,
      );
      if (activePods.length === 0) {
        console.log(`All pods for ${deploymentName} terminated.`);
        return true;
      }
      console.log(
        `Waiting for ${activePods.length} pod(s) for ${deploymentName} to terminate...`,
      );
      return false;
    },
    {
      timeoutMs,
      intervalMs: 2000,
      label: `Pods for ${deploymentName} terminated`,
    },
  );
}
