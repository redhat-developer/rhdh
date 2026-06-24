import * as k8s from "@kubernetes/client-node";

import {
  DEFAULT_BACKSTAGE_LABEL_SELECTOR,
  formatEventTimestamp,
  getEventSortTimestamp,
  getKubeApiErrorMessage,
  podNameOrUnknown,
} from "../helpers";

const BACKSTAGE_POD_NAME_FRAGMENT = "backstage-developer-hub";

function collectPodNames(
  podsResponse: { body: { items: k8s.V1Pod[] } },
  allPodsResponse: { body: { items: k8s.V1Pod[] } },
): Set<string> {
  const podNames = new Set<string>();
  podsResponse.body.items.forEach((pod) => {
    const name = pod.metadata?.name;
    if (name !== undefined && name !== "") {
      podNames.add(name);
    }
  });
  allPodsResponse.body.items.forEach((pod) => {
    const name = pod.metadata?.name;
    if (name !== undefined && name !== "" && name.includes(BACKSTAGE_POD_NAME_FRAGMENT)) {
      podNames.add(name);
    }
  });
  return podNames;
}

function isRelevantPodEvent(event: k8s.CoreV1Event, podNames: Set<string>): boolean {
  const involvedObject = event.involvedObject;
  if (involvedObject?.kind !== "Pod") {
    return false;
  }

  const podName = involvedObject.name;
  if (podName === undefined || podName === "") {
    return false;
  }

  return podNames.has(podName) || podName.includes(BACKSTAGE_POD_NAME_FRAGMENT);
}

function logPodEvent(event: k8s.CoreV1Event): void {
  const podName = podNameOrUnknown(event.involvedObject?.name);
  const timestamp = formatEventTimestamp(event);
  console.log(`  [${timestamp}] Pod ${podName}: [${event.type}] ${event.reason}: ${event.message}`);
}

async function logExistingPodLogs(
  coreV1Api: k8s.CoreV1Api,
  pods: k8s.V1Pod[],
  namespace: string,
): Promise<void> {
  console.log("\nAttempting to get logs from existing pods:");
  for (const pod of pods.slice(0, 3)) {
    const podName = pod.metadata?.name;
    if (podName === undefined || podName === "") {
      continue;
    }

    try {
      const logs = await coreV1Api.readNamespacedPodLog(
        podName,
        namespace,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        50,
      );
      if (logs.body !== undefined && logs.body !== "") {
        const logLines = logs.body.split("\n").slice(-20);
        console.log(`\n  Pod ${podName} logs (last 20 lines):`);
        logLines.forEach((line) => {
          if (line.trim() !== "") {
            console.log(`    ${line}`);
          }
        });
      }
    } catch (logError) {
      console.log(`  Could not get logs from ${podName}: ${getKubeApiErrorMessage(logError)}`);
    }
  }
}

async function fetchPodEventContext(
  coreV1Api: k8s.CoreV1Api,
  namespace: string,
  selector: string,
): Promise<{
  podsResponse: { body: { items: k8s.V1Pod[] } };
  podEvents: k8s.CoreV1Event[];
}> {
  const podsResponse = await coreV1Api.listNamespacedPod(
    namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    selector,
  );
  const allPodsResponse = await coreV1Api.listNamespacedPod(namespace);
  const eventsResponse = await coreV1Api.listNamespacedEvent(namespace);
  const podNames = collectPodNames(podsResponse, allPodsResponse);

  const podEvents = [...eventsResponse.body.items]
    .filter((event) => isRelevantPodEvent(event, podNames))
    // oxlint-disable-next-line unicorn/no-array-sort -- es2022 lib has no Array#toSorted
    .sort(
      (a: k8s.CoreV1Event, b: k8s.CoreV1Event) =>
        getEventSortTimestamp(b) - getEventSortTimestamp(a),
    )
    .slice(0, 30);

  return { podsResponse, podEvents };
}

export async function logPodEventsImpl(
  coreV1Api: k8s.CoreV1Api,
  namespace: string,
  labelSelector?: string,
): Promise<void> {
  const selector = labelSelector ?? DEFAULT_BACKSTAGE_LABEL_SELECTOR;

  try {
    const { podsResponse, podEvents } = await fetchPodEventContext(coreV1Api, namespace, selector);

    if (podEvents.length > 0) {
      console.log(`Recent pod events (last ${podEvents.length}):`);
      for (const event of podEvents) {
        logPodEvent(event);
      }
    } else {
      console.log("No recent pod events found");
    }

    if (podsResponse.body.items.length > 0) {
      await logExistingPodLogs(coreV1Api, podsResponse.body.items, namespace);
    }
  } catch (error) {
    console.error(
      `Error retrieving pod events for selector '${selector}': ${getKubeApiErrorMessage(error)}`,
    );
  }
}

export async function logDeploymentEventsImpl(
  coreV1Api: k8s.CoreV1Api,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  try {
    const eventsResponse = await coreV1Api.listNamespacedEvent(
      namespace,
      undefined,
      undefined,
      undefined,
      `involvedObject.name=${deploymentName}`,
    );

    console.log(
      `Events for deployment ${deploymentName}: ${JSON.stringify(
        eventsResponse.body.items.map((event) => ({
          message: event.message,
          reason: event.reason,
          type: event.type,
        })),
        null,
        2,
      )}`,
    );
  } catch (error) {
    console.error(
      `Error retrieving events for deployment ${deploymentName}: ${getKubeApiErrorMessage(error)}`,
    );
  }
}
