/**
 * Prove auth config is persisted and the new workload has mounted it.
 *
 * Backstage reads app-config at process start. Updating the ConfigMap alone is
 * not enough — reconcile must force new pods and prove the marker is present in
 * the mounted file before tests assume resolvers / sessionDuration / autologout.
 *
 * Does not wait for Deployment Available — callers use HTTP /healthcheck next
 * so 503s fail fast instead of burning the Available timeout.
 */

import * as k8s from "@kubernetes/client-node";
import * as yaml from "yaml";

import { execPodCommandImpl } from "../../kube-client/exec";
import { pollUntil } from "../../poll-until";
import { buildDeploymentLabelSelector, labelSelectorFromMatchLabels } from "./deployment-labels";
import { RHDHDeploymentState, isRecord } from "./types";

const POLL_INTERVAL_MS = 500;
const POD_UID_WAIT_TIMEOUT_MS = 120_000;
const MOUNTED_APP_CONFIG_PATH = "/opt/app-root/src/app-config.yaml";
const BACKSTAGE_BACKEND_CONTAINER = "backstage-backend";

async function getLabeledDeployment(state: RHDHDeploymentState): Promise<k8s.V1Deployment> {
  const labelSelector = buildDeploymentLabelSelector(state.instanceName);
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

async function getPodLabelSelector(state: RHDHDeploymentState): Promise<string> {
  const deployment = await getLabeledDeployment(state);
  const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
  if (Object.keys(matchLabels).length === 0) {
    throw new Error(
      `Deployment ${deployment.metadata?.name ?? "unknown"} has no selector.matchLabels`,
    );
  }
  return labelSelectorFromMatchLabels(matchLabels);
}

async function listRunningPods(
  state: RHDHDeploymentState,
  labelSelector: string,
): Promise<k8s.V1Pod[]> {
  const pods = await state.k8sApi.listNamespacedPod(
    state.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    labelSelector,
  );

  return pods.body.items.filter(
    (pod) => pod.status?.phase === "Running" && pod.metadata?.deletionTimestamp === undefined,
  );
}

async function listRunningPodUids(state: RHDHDeploymentState): Promise<string[]> {
  const labelSelector = await getPodLabelSelector(state);
  const pods = await listRunningPods(state, labelSelector);
  return pods
    .map((pod) => pod.metadata?.uid)
    .filter((uid): uid is string => typeof uid === "string" && uid.length > 0)
    .toSorted();
}

async function newestRunningPodName(state: RHDHDeploymentState): Promise<string> {
  const labelSelector = await getPodLabelSelector(state);
  const pods = await listRunningPods(state, labelSelector);
  if (pods.length === 0) {
    throw new Error(`No Running pods with labels ${labelSelector} in ${state.namespace}`);
  }
  pods.sort((a, b) => {
    const aCreated = a.metadata?.creationTimestamp
      ? new Date(a.metadata.creationTimestamp).getTime()
      : 0;
    const bCreated = b.metadata?.creationTimestamp
      ? new Date(b.metadata.creationTimestamp).getTime()
      : 0;
    return bCreated - aCreated;
  });
  const name = pods[0]?.metadata?.name;
  if (name === undefined || name === "") {
    throw new Error(`Running pod missing metadata.name (${labelSelector})`);
  }
  return name;
}

/** True when remote YAML parses to the same object as in-memory appConfig. */
export function appConfigMatchesExpected(
  remoteYaml: string,
  expectedAppConfig: Record<string, unknown>,
): boolean {
  const remoteParsed: unknown = yaml.parse(remoteYaml);
  if (!isRecord(remoteParsed)) {
    return false;
  }
  const expectedNormalized: unknown = yaml.parse(yaml.stringify(expectedAppConfig));
  return JSON.stringify(remoteParsed) === JSON.stringify(expectedNormalized);
}

/**
 * Re-read the remote ConfigMap and fail if it does not match in-memory appConfig.
 * Local mode writes the file during updateAppConfig; nothing to assert remotely.
 */
export async function assertAppConfigPersisted(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    return;
  }

  const response = await state.k8sApi.readNamespacedConfigMap(state.appConfigMap, state.namespace);
  const remoteYaml = response.body.data?.["app-config.yaml"];
  if (remoteYaml === undefined || remoteYaml === "") {
    throw new Error(
      `ConfigMap ${state.appConfigMap} in ${state.namespace} has no app-config.yaml data`,
    );
  }

  if (!appConfigMatchesExpected(remoteYaml, state.appConfig)) {
    throw new Error(
      `Persisted app-config in ConfigMap ${state.appConfigMap} does not match expected in-memory config`,
    );
  }

  console.log(`[INFO] Persisted app-config matches expected config (${state.appConfigMap})`);
}

/**
 * Prove the new pod's mounted app-config contains the reconcile marker
 * (effective load path, not just ConfigMap API bytes).
 */
export async function assertMountedAppConfigContainsMarker(
  state: RHDHDeploymentState,
  marker: string,
): Promise<void> {
  if (state.isRunningLocal) {
    return;
  }

  await pollUntil(
    async () => {
      try {
        const podName = await newestRunningPodName(state);
        const { stdout } = await execPodCommandImpl(
          state.kc,
          podName,
          state.namespace,
          BACKSTAGE_BACKEND_CONTAINER,
          ["cat", MOUNTED_APP_CONFIG_PATH],
          30_000,
        );
        return stdout.includes(marker);
      } catch (error) {
        console.log(
          `[INFO] Mounted app-config marker check not ready yet: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      }
    },
    {
      timeoutMs: POD_UID_WAIT_TIMEOUT_MS,
      intervalMs: POLL_INTERVAL_MS,
      label: `Mounted app-config contains marker ${marker}`,
    },
  );
  console.log(`[INFO] Mounted app-config contains reconcile marker ${marker}`);
}

/**
 * Force new pods so they remount ConfigMaps and Backstage reloads config.
 * Deletes Running pods (operator recreates them) rather than patching the
 * Deployment template, which the operator may overwrite on reconcile.
 */
export async function restartRemoteDeployment(state: RHDHDeploymentState): Promise<void> {
  if (state.isRunningLocal) {
    return;
  }

  const labelSelector = await getPodLabelSelector(state);
  const running = await listRunningPods(state, labelSelector);

  if (running.length === 0) {
    throw new Error(
      `No Running pods found to restart with labels ${labelSelector} in ${state.namespace}`,
    );
  }

  for (const pod of running) {
    const name = pod.metadata?.name;
    if (name === undefined || name === "") {
      continue;
    }
    console.log(`[INFO] Deleting pod ${name} to reload auth config`);
    await state.k8sApi.deleteNamespacedPod(name, state.namespace);
  }
}

/**
 * After a forced restart, wait until Running pod UIDs differ from the baseline
 * (proves we are not still talking to the pre-restart process).
 */
export async function waitForPodUidChange(
  state: RHDHDeploymentState,
  previousUids: readonly string[],
  timeoutMs: number = POD_UID_WAIT_TIMEOUT_MS,
): Promise<void> {
  if (state.isRunningLocal) {
    return;
  }

  const baseline = [...previousUids].toSorted().join(",");
  await pollUntil(
    async () => {
      const current = await listRunningPodUids(state);
      if (current.length === 0) {
        return false;
      }
      return current.join(",") !== baseline;
    },
    {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      label: `Pod UID change after config restart (was [${baseline}])`,
    },
  );
  console.log("[INFO] New Running pod UID(s) detected after config restart");
}

export function captureRunningPodUids(state: RHDHDeploymentState): Promise<string[]> {
  if (state.isRunningLocal) {
    return Promise.resolve([]);
  }
  return listRunningPodUids(state);
}

/**
 * Remote config-liveness: persisted CM → restart → new pods → marker in mount.
 * Callers must follow with HTTP /healthcheck (not Deployment Available).
 */
export async function waitUntilAuthConfigLive(
  state: RHDHDeploymentState,
  configMarker: string,
): Promise<void> {
  if (state.isRunningLocal) {
    return;
  }

  await assertAppConfigPersisted(state);
  const previousUids = await captureRunningPodUids(state);
  await restartRemoteDeployment(state);
  await waitForPodUidChange(state, previousUids);
  await assertMountedAppConfigContainsMarker(state, configMarker);
  console.log("[INFO] Auth config live: persisted, restarted, marker mounted");
}
