import * as k8s from "@kubernetes/client-node";
import { V1ConfigMap } from "@kubernetes/client-node";
import { hasStatusCode } from "./errors";
import {
  findAppConfigMapName,
  updateConfigMapTitleImpl,
} from "./kube-client-configmap";
import {
  logDeploymentEventsImpl,
  logPodEventsImpl,
} from "./kube-client-diagnostics-events";
import {
  logPodConditionsForDeploymentImpl,
  logPodContainerLogsImpl,
  logPodConditionsImpl,
} from "./kube-client-diagnostics-pods";
import { logReplicaSetStatusImpl } from "./kube-client-diagnostics-replicasets";
import { restartDeploymentImpl } from "./kube-client-deployment-restart";
import {
  getDeploymentPodSelectorImpl,
  scaleDeploymentImpl,
} from "./kube-client-deployment-scale";
import { waitForDeploymentReadyImpl } from "./kube-client-deployment-wait";
import { execPodCommandImpl } from "./kube-client-exec";
import {
  formatKubeErrorLog,
  getErrorStatusCode,
  getKubeApiErrorMessage,
  getRhdhDeploymentName,
  PodFailureResult,
  rejectAsError,
} from "./kube-client-helpers";
import { checkPodFailureStatesImpl } from "./kube-client-pod-failure";

export { getRhdhDeploymentName };
export type { PodFailureResult };

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
      console.log(
        `Error initializing KubeClient: ${getKubeApiErrorMessage(e)}`,
      );
      throw e;
    }
  }

  async getConfigMap(configmapName: string, namespace: string) {
    try {
      console.log(
        `Getting configmap ${configmapName} from namespace ${namespace}`,
      );
      return await this.coreV1Api.readNamespacedConfigMap(
        configmapName,
        namespace,
      );
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
    return findAppConfigMapName(
      this.coreV1Api,
      (ns) => this.listConfigMaps(ns),
      namespace,
    );
  }

  async getNamespaceByName(name: string): Promise<k8s.V1Namespace | null> {
    try {
      return (await this.coreV1Api.readNamespace(name)).body;
    } catch (e) {
      console.log(
        `Error getting namespace ${name}: ${getKubeApiErrorMessage(e)}`,
      );
      throw e;
    }
  }

  scaleDeployment(
    deploymentName: string,
    namespace: string,
    replicas: number,
    maxRetries: number = 3,
  ) {
    return scaleDeploymentImpl(
      this.appsApi,
      deploymentName,
      namespace,
      replicas,
      maxRetries,
    );
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

  async updateConfigMap(
    configmapName: string,
    namespace: string,
    patch: object,
  ) {
    try {
      console.log("updateConfigMap called");
      console.log("Namespace: ", namespace);
      console.log("ConfigMap: ", configmapName);
      const options = {
        headers: { "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH },
      };
      console.log(
        `Updating configmap ${configmapName} in namespace ${namespace}`,
      );
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

  updateConfigMapTitle(
    configMapName: string,
    namespace: string,
    newTitle: string,
  ) {
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
      console.log(
        `Creating configmap ${configMapName} in namespace ${namespace}`,
      );
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
        console.log(
          `Error deleting namespace ${namespace}: ${getKubeApiErrorMessage(err)}`,
        );
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

  async createOrUpdateSecret(
    secret: k8s.V1Secret,
    namespace: string,
  ): Promise<void> {
    const secretName = secret.metadata?.name;
    if (secretName === undefined || secretName === "") {
      throw new Error("Secret metadata.name is required");
    }

    try {
      const existing = await this.coreV1Api.readNamespacedSecret(
        secretName,
        namespace,
      );
      const body = existing.body;
      body.data = { ...body.data, ...secret.data };
      await this.coreV1Api.replaceNamespacedSecret(secretName, namespace, body);
      console.log(`Secret ${secretName} updated in namespace ${namespace}`);
    } catch (err: unknown) {
      const statusCode = getErrorStatusCode(err);
      if (statusCode === 404) {
        console.log(
          `Secret ${secretName} not found, creating in namespace ${namespace}`,
        );
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
      (name, ns, replicas, t) =>
        this.waitForDeploymentReady(name, ns, replicas, t),
      (name, ns) => this.logPodConditionsForDeployment(name, ns),
      (name, ns) => this.logDeploymentEvents(name, ns),
      deploymentName,
      namespace,
    );
  }

  private getDeploymentPodSelector(
    deploymentName: string,
    namespace: string,
  ): Promise<string> {
    return getDeploymentPodSelectorImpl(
      this.appsApi,
      deploymentName,
      namespace,
    );
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

  logPodContainerLogs(
    namespace: string,
    labelSelector?: string,
    containerName?: string,
  ) {
    return logPodContainerLogsImpl(
      this.coreV1Api,
      namespace,
      labelSelector,
      containerName,
    );
  }

  logPodEvents(namespace: string, labelSelector?: string) {
    return logPodEventsImpl(this.coreV1Api, namespace, labelSelector);
  }

  logDeploymentEvents(deploymentName: string, namespace: string) {
    return logDeploymentEventsImpl(this.coreV1Api, deploymentName, namespace);
  }

  logReplicaSetStatus(deploymentName: string, namespace: string) {
    return logReplicaSetStatusImpl(
      this.coreV1Api,
      this.appsApi,
      deploymentName,
      namespace,
    );
  }

  async getServiceByLabel(
    namespace: string,
    labelSelector: string,
  ): Promise<k8s.V1Service[]> {
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
    return execPodCommandImpl(
      this.kc,
      podName,
      namespace,
      containerName,
      command,
      timeout,
    );
  }
}
