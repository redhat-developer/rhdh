import * as k8s from "@kubernetes/client-node";
import { V1ConfigMap } from "@kubernetes/client-node";
import * as yaml from "js-yaml";

import { hasStatusCode } from "../errors";
import { findAppConfigMapName, updateConfigMapTitleImpl } from "./configmap";
import { restartDeploymentImpl } from "./deployment/restart";
import { getDeploymentPodSelectorImpl, scaleDeploymentImpl } from "./deployment/scale";
import { waitForDeploymentReadyImpl } from "./deployment/wait";
import { logDeploymentEventsImpl, logPodEventsImpl } from "./diagnostics/events";
import {
  logPodConditionsForDeploymentImpl,
  logPodContainerLogsImpl,
  logPodConditionsImpl,
} from "./diagnostics/pods";
import { logReplicaSetStatusImpl } from "./diagnostics/replicasets";
import { execPodCommandImpl } from "./exec";
import {
  BACKSTAGE_BACKEND_CONTAINER,
  formatKubeErrorLog,
  getErrorStatusCode,
  getKubeApiErrorMessage,
  getRhdhDeploymentName,
  isRecord,
  PodFailureResult,
  rejectAsError,
} from "./helpers";
import { checkPodFailureStatesImpl } from "./pod-failure";

export { BACKSTAGE_BACKEND_CONTAINER, getErrorStatusCode, getRhdhDeploymentName, isRecord };
export type { PodFailureResult };

export async function waitForBackstageCrd(
  customObjectsApi: k8s.CustomObjectsApi,
  timeoutMs: number = 60000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await customObjectsApi.getClusterCustomObject(
        "apiextensions.k8s.io",
        "v1",
        "customresourcedefinitions",
        "backstages.rhdh.redhat.com",
      );
      return;
    } catch {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 5000);
      });
    }
  }
  throw new Error(`Backstage CRD not available after ${timeoutMs}ms`);
}

export class KubeClient {
  coreV1Api: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
  customObjectsApi: k8s.CustomObjectsApi;
  kc: k8s.KubeConfig;

  constructor() {
    try {
      this.kc = new k8s.KubeConfig();
      this.kc.loadFromOptions({
        clusters: [
          {
            name: "my-openshift-cluster",
            server: process.env.K8S_CLUSTER_URL ?? "",
            skipTLSVerify: true,
          },
        ],
        users: [
          {
            name: "ci-user",
            token: process.env.K8S_CLUSTER_TOKEN ?? "",
          },
        ],
        contexts: [
          {
            name: "default-context",
            user: "ci-user",
            cluster: "my-openshift-cluster",
          },
        ],
        currentContext: "default-context",
      });

      this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api);
      this.customObjectsApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    } catch (e) {
      console.log(`Error initializing KubeClient: ${getKubeApiErrorMessage(e)}`);
      throw e;
    }
  }

  async getConfigMap(configmapName: string, namespace: string) {
    try {
      console.log(`Getting configmap ${configmapName} from namespace ${namespace}`);
      return await this.coreV1Api.readNamespacedConfigMap(configmapName, namespace);
    } catch (e) {
      console.log(formatKubeErrorLog(e));
      throw e;
    }
  }

  async listConfigMaps(namespace: string) {
    try {
      console.log(`Listing configmaps in namespace ${namespace}`);
      return await this.coreV1Api.listNamespacedConfigMap(namespace);
    } catch (e) {
      console.error(formatKubeErrorLog(e));
      throw e;
    }
  }

  findAppConfigMap(namespace: string): Promise<string> {
    return findAppConfigMapName(this.coreV1Api, (ns) => this.listConfigMaps(ns), namespace);
  }

  async getNamespaceByName(name: string): Promise<k8s.V1Namespace | null> {
    try {
      return (await this.coreV1Api.readNamespace(name)).body;
    } catch (e) {
      console.log(`Error getting namespace ${name}: ${getKubeApiErrorMessage(e)}`);
      throw e;
    }
  }

  scaleDeployment(
    deploymentName: string,
    namespace: string,
    replicas: number,
    maxRetries: number = 3,
  ) {
    return scaleDeploymentImpl(this.appsApi, deploymentName, namespace, replicas, maxRetries);
  }

  async getSecret(secretName: string, namespace: string) {
    try {
      console.log(`Getting secret ${secretName} from namespace ${namespace}`);
      return await this.coreV1Api.readNamespacedSecret(secretName, namespace);
    } catch (e) {
      console.log(formatKubeErrorLog(e));
      throw e;
    }
  }

  async updateConfigMap(configmapName: string, namespace: string, patch: object) {
    try {
      console.log("updateConfigMap called");
      console.log("Namespace: ", namespace);
      console.log("ConfigMap: ", configmapName);
      const options = {
        headers: { "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH },
      };
      console.log(`Updating configmap ${configmapName} in namespace ${namespace}`);
      await this.coreV1Api.patchNamespacedConfigMap(
        configmapName,
        namespace,
        patch,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        options,
      );
    } catch (e) {
      console.log(`Error updating configmap: ${getKubeApiErrorMessage(e)}`);
      throw e;
    }
  }

  updateConfigMapTitle(configMapName: string, namespace: string, newTitle: string) {
    return updateConfigMapTitleImpl(
      this.coreV1Api,
      (name, ns) => this.getConfigMap(name, ns),
      (ns) => this.findAppConfigMap(ns),
      configMapName,
      namespace,
      newTitle,
    );
  }

  async updateSecret(secretName: string, namespace: string, patch: object) {
    try {
      const options = {
        headers: {
          "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH,
        },
      };
      console.log(`Updating secret ${secretName} in namespace ${namespace}`);
      await this.coreV1Api.patchNamespacedSecret(
        secretName,
        namespace,
        patch,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        options,
      );
    } catch (e) {
      console.log(getKubeApiErrorMessage(e));
      throw e;
    }
  }

  async createCongifmap(namespace: string, body: V1ConfigMap) {
    try {
      const configMapName = body.metadata?.name;
      if (configMapName === undefined || configMapName === "") {
        throw new Error("ConfigMap metadata.name is required");
      }
      console.log(`Creating configmap ${configMapName} in namespace ${namespace}`);
      return await this.coreV1Api.createNamespacedConfigMap(namespace, body);
    } catch (err) {
      console.log(getKubeApiErrorMessage(err));
      throw err;
    }
  }

  async deleteNamespaceAndWait(namespace: string) {
    const watch = new k8s.Watch(this.kc);
    try {
      await this.coreV1Api.deleteNamespace(namespace);
      console.log(`Namespace '${namespace}' deletion initiated.`);

      await new Promise<void>((resolve, reject) => {
        void watch.watch(
          `/api/v1/namespaces?watch=true&fieldSelector=metadata.name=${namespace}`,
          {},
          (type) => {
            if (type === "DELETED") {
              console.log(`Namespace '${namespace}' has been deleted.`);
              resolve();
            }
          },
          (err: unknown) => {
            if (hasStatusCode(err) && err.statusCode === 404) {
              console.log(`Namespace '${namespace}' is already deleted.`);
              resolve();
            } else {
              rejectAsError(reject, err);
            }
          },
        );
      });
    } catch (err) {
      console.log(
        `Error deleting or waiting for namespace deletion: ${getKubeApiErrorMessage(err)}`,
      );
      throw err;
    }
  }

  async createNamespaceIfNotExists(namespace: string) {
    const nsList = await this.coreV1Api.listNamespace();
    const ns = nsList.body.items
      .map((item) => item.metadata?.name)
      .filter((name): name is string => name !== undefined);
    if (ns.includes(namespace)) {
      console.log(`Delete and re-create namespace ${namespace}`);
      try {
        await this.deleteNamespaceAndWait(namespace);
      } catch (err) {
        console.log(`Error deleting namespace ${namespace}: ${getKubeApiErrorMessage(err)}`);
        throw err;
      }
    }

    try {
      const createNamespaceRes = await this.coreV1Api.createNamespace({
        metadata: {
          name: namespace,
        },
      });
      const createdName = createNamespaceRes.body.metadata?.name;
      console.log(`Created namespace ${createdName ?? namespace}`);
    } catch (err) {
      console.log(getKubeApiErrorMessage(err));
      throw err;
    }
  }

  async createSecret(secret: k8s.V1Secret, namespace: string) {
    try {
      console.log(
        `Creating secret ${secret.metadata?.name ?? "unknown"} in namespace ${namespace}`,
      );
      await this.coreV1Api.createNamespacedSecret(namespace, secret);
    } catch (err) {
      console.log(getKubeApiErrorMessage(err));
      throw err;
    }
  }

  async createOrUpdateSecret(secret: k8s.V1Secret, namespace: string): Promise<void> {
    const secretName = secret.metadata?.name;
    if (secretName === undefined || secretName === "") {
      throw new Error("Secret metadata.name is required");
    }

    try {
      const existing = await this.coreV1Api.readNamespacedSecret(secretName, namespace);
      const body = existing.body;
      body.data = { ...body.data, ...secret.data };
      await this.coreV1Api.replaceNamespacedSecret(secretName, namespace, body);
      console.log(`Secret ${secretName} updated in namespace ${namespace}`);
    } catch (err: unknown) {
      const statusCode = getErrorStatusCode(err);
      if (statusCode === 404) {
        console.log(`Secret ${secretName} not found, creating in namespace ${namespace}`);
        await this.createSecret(secret, namespace);
        console.log(`Secret ${secretName} created in namespace ${namespace}`);
      } else {
        throw err;
      }
    }
  }

  checkPodFailureStates(
    namespace: string,
    labelSelector: string,
  ): Promise<PodFailureResult | null> {
    return checkPodFailureStatesImpl(this.coreV1Api, namespace, labelSelector);
  }

  waitForDeploymentReady(
    deploymentName: string,
    namespace: string,
    expectedReplicas: number,
    timeout: number = 300000,
    checkInterval: number = 10000,
    labelSelector?: string,
  ) {
    return waitForDeploymentReadyImpl(
      this.appsApi,
      (name, ns) => this.getDeploymentPodSelector(name, ns),
      (ns, selector) => this.checkPodFailureStates(ns, selector),
      (ns, selector) => this.logPodConditions(ns, selector),
      {
        logDeploymentEvents: (name, ns) => this.logDeploymentEvents(name, ns),
        logReplicaSetStatus: (name, ns) => this.logReplicaSetStatus(name, ns),
        logPodEvents: (ns, selector) => this.logPodEvents(ns, selector),
        logPodConditions: (ns, selector) => this.logPodConditions(ns, selector),
        logPodContainerLogs: (ns, selector, containerName) =>
          this.logPodContainerLogs(ns, selector, containerName),
      },
      deploymentName,
      namespace,
      expectedReplicas,
      timeout,
      checkInterval,
      labelSelector,
    );
  }

  restartDeployment(deploymentName: string, namespace: string) {
    return restartDeploymentImpl(
      (name, ns, replicas) => this.scaleDeployment(name, ns, replicas),
      (name, ns, replicas, t) => this.waitForDeploymentReady(name, ns, replicas, t),
      (name, ns) => this.logPodConditionsForDeployment(name, ns),
      (name, ns) => this.logDeploymentEvents(name, ns),
      deploymentName,
      namespace,
    );
  }

  private getDeploymentPodSelector(deploymentName: string, namespace: string): Promise<string> {
    return getDeploymentPodSelectorImpl(this.appsApi, deploymentName, namespace);
  }

  logPodConditionsForDeployment(deploymentName: string, namespace: string) {
    return logPodConditionsForDeploymentImpl(
      (ns, selector) => this.logPodConditions(ns, selector),
      (name, ns) => this.getDeploymentPodSelector(name, ns),
      deploymentName,
      namespace,
    );
  }

  logPodConditions(namespace: string, labelSelector: string) {
    return logPodConditionsImpl(this.coreV1Api, namespace, labelSelector);
  }

  logPodContainerLogs(namespace: string, labelSelector?: string, containerName?: string) {
    return logPodContainerLogsImpl(this.coreV1Api, namespace, labelSelector, containerName);
  }

  logPodEvents(namespace: string, labelSelector?: string) {
    return logPodEventsImpl(this.coreV1Api, namespace, labelSelector);
  }

  logDeploymentEvents(deploymentName: string, namespace: string) {
    return logDeploymentEventsImpl(this.coreV1Api, deploymentName, namespace);
  }

  logReplicaSetStatus(deploymentName: string, namespace: string) {
    return logReplicaSetStatusImpl(this.coreV1Api, this.appsApi, deploymentName, namespace);
  }

  async getServiceByLabel(namespace: string, labelSelector: string): Promise<k8s.V1Service[]> {
    try {
      const response = await this.coreV1Api.listNamespacedService(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector,
      );
      return response.body.items;
    } catch (error) {
      console.error(
        `Error fetching services with label ${labelSelector}: ${getKubeApiErrorMessage(error)}`,
      );
      throw error;
    }
  }

  execPodCommand(
    podName: string,
    namespace: string,
    containerName: string,
    command: string[],
    timeout: number = 60000,
  ): Promise<{ stdout: string; stderr: string }> {
    return execPodCommandImpl(this.kc, podName, namespace, containerName, command, timeout);
  }

  createConfigMap(namespace: string, body: V1ConfigMap) {
    return this.createCongifmap(namespace, body);
  }

  async deleteNamespaceIfExists(namespace: string): Promise<void> {
    try {
      await this.coreV1Api.readNamespace(namespace);
      console.log(`Namespace ${namespace} exists, deleting...`);
      await this.deleteNamespaceAndWait(namespace);
    } catch (err: unknown) {
      const statusCode = getErrorStatusCode(err);
      if (statusCode === 404) {
        console.log(`Namespace ${namespace} does not exist`);
      } else {
        throw err;
      }
    }
  }

  async createNamespace(namespace: string): Promise<void> {
    try {
      const res = await this.coreV1Api.createNamespace({
        metadata: { name: namespace },
      });
      const createdName = res.body.metadata?.name;
      console.log(`Created namespace ${createdName ?? namespace}`);
    } catch (err: unknown) {
      const statusCode = getErrorStatusCode(err);
      if (statusCode === 409) {
        console.log(`Namespace ${namespace} already exists`);
        return;
      }
      console.log(getKubeApiErrorMessage(err));
      throw err;
    }
  }

  async patchAppConfig(
    namespace: string,
    patchFn: (appConfig: Record<string, unknown>) => void,
  ): Promise<void> {
    const configMapName = await this.findAppConfigMap(namespace);
    const response = await this.getConfigMap(configMapName, namespace);
    const configMap = response.body;
    const configKey = Object.keys(configMap.data ?? {}).find((key) => key.includes("app-config"));

    if (configKey === undefined || configKey === "" || !configMap.data) {
      throw new Error(`No app-config data key found in ConfigMap '${configMapName}'`);
    }

    const parsed: unknown = yaml.load(configMap.data[configKey]);
    if (!isRecord(parsed)) {
      throw new Error(`Invalid YAML structure in ConfigMap key '${configKey}'`);
    }
    const appConfig = parsed;
    const before = configMap.data[configKey];

    patchFn(appConfig);

    const after = yaml.dump(appConfig);
    if (before === after) {
      console.log("patchAppConfig: no changes needed");
      return;
    }

    configMap.data[configKey] = after;
    delete configMap.metadata?.creationTimestamp;
    delete configMap.metadata?.resourceVersion;
    await this.coreV1Api.replaceNamespacedConfigMap(configMapName, namespace, configMap);
    console.log("patchAppConfig: ConfigMap updated");
  }

  async jsonPatchDeployment(
    deploymentName: string,
    namespace: string,
    patch: object[],
  ): Promise<void> {
    await this.appsApi.patchNamespacedDeployment(
      deploymentName,
      namespace,
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/json-patch+json" } },
    );
  }

  /**
   * Apply a JSON merge-patch to a namespaced custom object.
   * Centralises the Content-Type header so callers don't need to pass
   * trailing positional `undefined` args to reach the options parameter.
   */
  async mergePatchCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string,
    patch: object,
  ): Promise<void> {
    await this.customObjectsApi.patchNamespacedCustomObject(
      group,
      version,
      namespace,
      plural,
      name,
      patch,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": k8s.PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } },
    );
  }

  async restartDeploymentWithRetry(
    deploymentName: string,
    namespace: string,
    maxAttempts: number = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Restarting deployment (attempt ${attempt}/${maxAttempts})...`);
        await this.restartDeployment(deploymentName, namespace);
        console.log("Deployment restart completed");
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) {
          console.warn(
            `Restart attempt ${attempt}/${maxAttempts} failed: ${msg}. Retrying in 30s...`,
          );
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
            }, 30000);
          });
        } else {
          throw new Error(`Deployment restart failed after ${maxAttempts} attempts: ${msg}`, {
            cause: error,
          });
        }
      }
    }
  }

  async removeContainerEnvVars(
    deploymentName: string,
    namespace: string,
    containerName: string,
    filterFn: (envVar: k8s.V1EnvVar) => boolean,
  ): Promise<number> {
    const response = await this.appsApi.readNamespacedDeployment(deploymentName, namespace);
    const containers = response.body.spec?.template?.spec?.containers ?? [];
    const containerIdx = containers.findIndex((c) => c.name === containerName);
    if (containerIdx === -1) return 0;

    const env = containers[containerIdx].env ?? [];
    const indicesToRemove = env
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => filterFn(e))
      .map(({ idx }) => idx);

    if (indicesToRemove.length === 0) return 0;

    // toSorted requires ES2023 lib; spread creates a copy to avoid mutation
    const sorted = [...indicesToRemove];
    // oxlint-disable-next-line unicorn/no-array-sort
    sorted.sort((a: number, b: number) => b - a);
    const patch = sorted.map((idx: number) => ({
      op: "remove" as const,
      path: `/spec/template/spec/containers/${containerIdx}/env/${idx}`,
    }));

    await this.jsonPatchDeployment(deploymentName, namespace, patch);
    return indicesToRemove.length;
  }

  async addContainerEnvVarsFromSecret(
    deploymentName: string,
    namespace: string,
    containerName: string,
    secretName: string,
    envVarNames: string[],
  ): Promise<void> {
    const response = await this.appsApi.readNamespacedDeployment(deploymentName, namespace);
    const containers = response.body.spec?.template?.spec?.containers ?? [];
    const containerIdx = containers.findIndex((c) => c.name === containerName);
    if (containerIdx === -1) {
      console.warn(`Container ${containerName} not found in deployment ${deploymentName}`);
      return;
    }

    const existingEnv = containers[containerIdx].env ?? [];
    const patch: Array<{ op: string; path: string; value?: unknown }> = [];

    // Remove existing env vars with the same names (reverse order)
    const indicesToRemove = existingEnv
      .map((e, idx) => ({ name: e.name, idx }))
      .filter((e) => envVarNames.includes(e.name))
      .map((e) => e.idx);

    if (indicesToRemove.length > 0) {
      // oxlint-disable-next-line unicorn/no-array-sort -- toSorted requires ES2023 lib; spread creates a copy
      for (const idx of [...indicesToRemove].sort((a: number, b: number) => b - a)) {
        patch.push({
          op: "remove",
          path: `/spec/template/spec/containers/${containerIdx}/env/${idx}`,
        });
      }
    }

    // Add fresh env vars from the secret
    for (const name of envVarNames) {
      patch.push({
        op: "add",
        path: `/spec/template/spec/containers/${containerIdx}/env/-`,
        value: {
          name,
          valueFrom: {
            secretKeyRef: { name: secretName, key: name },
          },
        },
      });
    }

    await this.jsonPatchDeployment(deploymentName, namespace, patch);
  }
}
