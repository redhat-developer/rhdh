import * as k8s from "@kubernetes/client-node";

import { getKubeApiErrorMessage, podNameOrUnknown } from "../helpers";

function sortReplicaSetsByCreation(replicaSets: k8s.V1ReplicaSet[]): k8s.V1ReplicaSet[] {
  return replicaSets.toSorted((a: k8s.V1ReplicaSet, b: k8s.V1ReplicaSet) => {
    const aTime = a.metadata?.creationTimestamp?.getTime() ?? 0;
    const bTime = b.metadata?.creationTimestamp?.getTime() ?? 0;
    return bTime - aTime;
  });
}

function logReplicaSetSummary(rs: k8s.V1ReplicaSet): void {
  const rsName = podNameOrUnknown(rs.metadata?.name);
  const readyReplicas = rs.status?.readyReplicas ?? 0;
  const availableReplicas = rs.status?.availableReplicas ?? 0;
  const replicas = rs.status?.replicas ?? 0;
  const fullyLabeledReplicas = rs.status?.fullyLabeledReplicas ?? 0;
  const conditions = rs.status?.conditions ?? [];

  console.log(`  ReplicaSet: ${rsName}`);
  console.log(
    `    Ready: ${readyReplicas}, Available: ${availableReplicas}, Desired: ${replicas}, Fully Labeled: ${fullyLabeledReplicas}`,
  );
  if (conditions.length > 0) {
    console.log(`    Conditions: ${JSON.stringify(conditions, null, 2)}`);
  }
}

async function logReplicaSetEvents(
  coreV1Api: k8s.CoreV1Api,
  namespace: string,
  rsName: string,
): Promise<void> {
  try {
    const rsEvents = await coreV1Api.listNamespacedEvent(
      namespace,
      undefined,
      undefined,
      undefined,
      `involvedObject.name=${rsName}`,
    );

    if (rsEvents.body.items.length > 0) {
      console.log(`    Events for ReplicaSet ${rsName}:`);
      rsEvents.body.items.slice(0, 10).forEach((event) => {
        console.log(`      [${event.type}] ${event.reason}: ${event.message}`);
      });
      return;
    }

    console.log(`    No events found for ReplicaSet ${rsName}`);
  } catch (error) {
    console.warn(
      `    Could not retrieve events for ReplicaSet ${rsName}: ${getKubeApiErrorMessage(error)}`,
    );
  }
}

export async function logReplicaSetStatusImpl(
  coreV1Api: k8s.CoreV1Api,
  appsApi: k8s.AppsV1Api,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  try {
    const deployment = await appsApi.readNamespacedDeployment(deploymentName, namespace);

    const labelSelector = deployment.body.spec?.selector?.matchLabels;
    if (labelSelector === undefined) {
      console.warn(`Deployment ${deploymentName} has no label selector`);
      return;
    }

    const selectorString = Object.entries(labelSelector)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    const rsResponse = await appsApi.listNamespacedReplicaSet(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      selectorString,
    );

    console.log(
      `Found ${rsResponse.body.items.length} ReplicaSet(s) for deployment ${deploymentName}:`,
    );

    const sortedReplicaSets = sortReplicaSetsByCreation(rsResponse.body.items);
    for (const rs of sortedReplicaSets) {
      logReplicaSetSummary(rs);
      const rsName = rs.metadata?.name;
      if (rsName !== undefined && rsName !== "") {
        await logReplicaSetEvents(coreV1Api, namespace, rsName);
      }
    }
  } catch (error) {
    console.error(
      `Error retrieving ReplicaSet status for deployment ${deploymentName}: ${getKubeApiErrorMessage(error)}`,
    );
  }
}
