import * as k8s from "@kubernetes/client-node";
import { V1ConfigMap } from "@kubernetes/client-node";
import { LOGGER } from "./logger";
import * as yaml from "js-yaml";

export class KubeClient {
  coreV1Api: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
  kc: k8s.KubeConfig;

  constructor() {
    try {
      this.kc = new k8s.KubeConfig();
      this.kc.loadFromOptions({
        clusters: [
          {
            name: "my-openshift-cluster",
            server: process.env.K8S_CLUSTER_URL,
            skipTLSVerify: true,
          },
        ],
        users: [
          {
            name: "ci-user",
            token: process.env.K8S_CLUSTER_TOKEN,
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
    } catch (e) {
      LOGGER.info(e);
      throw e;
    }
  }

  async getConfigMap(configmapName: string, namespace: string) {
    try {
      LOGGER.info(
        `Getting configmap ${configmapName} from namespace ${namespace}`,
      );
      return await this.coreV1Api.readNamespacedConfigMap(
        configmapName,
        namespace,
      );
    } catch (e) {
      LOGGER.error(e.body?.message);
      throw e;
    }
  }

  async getNamespaceByName(name: string): Promise<k8s.V1Namespace | null> {
    try {
      LOGGER.debug(`Getting namespace ${name}.`);
      return (await this.coreV1Api.readNamespace(name)).body;
    } catch (e) {
      LOGGER.error(`Error getting namespace ${name}: ${e.body?.message}`);
      throw e;
    }
  }

  async scaleDeployment(
    deploymentName: string,
    namespace: string,
    replicas: number,
  ) {
    const patch = { spec: { replicas: replicas } };
    try {
      await this.appsApi.patchNamespacedDeploymentScale(
        deploymentName,
        namespace,
        patch,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          headers: { "Content-Type": "application/strategic-merge-patch+json" },
        },
      );
      console.log(`Deployment scaled to ${replicas} replicas.`);
    } catch (error) {
      console.error("Error scaling deployment:", error);
    }
  }

  async getSecret(secretName: string, namespace: string) {
    try {
      LOGGER.info(`Getting secret ${secretName} from namespace ${namespace}`);
      return await this.coreV1Api.readNamespacedSecret(secretName, namespace);
    } catch (e) {
      LOGGER.error(e.body.message);
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
      LOGGER.info(
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
      LOGGER.error(e.statusCode, e);
      throw e;
    }
  }

  async updateConfigMapTitle(
    configMapName: string,
    namespace: string,
    newTitle: string,
  ) {
    try {
      const configMapResponse = await this.getConfigMap(
        configMapName,
        namespace,
      );
      const configMap = configMapResponse.body;

      const appConfigYaml = configMap.data["app-config.yaml"];
      if (!appConfigYaml) {
        throw new Error(
          `app-config.yaml not found in ConfigMap ${configMapName}`,
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appConfigObj = yaml.load(appConfigYaml) as any;

      if (!appConfigObj) {
        throw new Error("Failed to parse YAML from app-config.yaml");
      }

      if (!appConfigObj.app) {
        appConfigObj.app = {};
      }

      appConfigObj.app.title = newTitle;
      configMap.data["app-config.yaml"] = yaml.dump(appConfigObj);

      delete configMap.metadata.creationTimestamp;

      await this.coreV1Api.replaceNamespacedConfigMap(
        configMapName,
        namespace,
        configMap,
      );
      console.log("ConfigMap updated successfully.");
    } catch (error) {
      console.error("Error updating ConfigMap:", error);
      throw new Error("Failed to update ConfigMap");
    }
  }

  async updateSecret(secretName: string, namespace: string, patch: object) {
    try {
      const options = {
        headers: {
          "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH,
        },
      };
      LOGGER.info(`Updating secret ${secretName} in namespace ${namespace}`);
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
      LOGGER.error(e.statusCode, e.body.message);
      throw e;
    }
  }

  async createCongifmap(namespace: string, body: V1ConfigMap) {
    try {
      LOGGER.info(
        `Creating configmap ${body.metadata.name} in namespace ${namespace}`,
      );
      return await this.coreV1Api.createNamespacedConfigMap(namespace, body);
    } catch (err) {
      LOGGER.error(err.body.message);
      throw err;
    }
  }

  async deleteNamespaceAndWait(namespace: string) {
    const watch = new k8s.Watch(this.kc);
    try {
      await this.coreV1Api.deleteNamespace(namespace);
      LOGGER.info(`Namespace '${namespace}' deletion initiated.`);

      await new Promise<void>((resolve, reject) => {
        watch.watch(
          `/api/v1/namespaces?watch=true&fieldSelector=metadata.name=${namespace}`,
          {},
          (type) => {
            if (type === "DELETED") {
              LOGGER.info(`Namespace '${namespace}' has been deleted.`);
              resolve();
            }
          },
          (err) => {
            if (err && err.statusCode === 404) {
              // Namespace was already deleted or does not exist
              LOGGER.info(`Namespace '${namespace}' is already deleted.`);
              resolve();
            } else {
              reject(err);
              throw err;
            }
          },
        );
      });
    } catch (err) {
      LOGGER.error("Error deleting or waiting for namespace deletion:", err);
      throw err;
    }
  }

  async createNamespaceIfNotExists(namespace: string) {
    const nsList = await this.coreV1Api.listNamespace();
    const ns = nsList.body.items.map((ns) => ns.metadata.name);
    if (ns.includes(namespace)) {
      LOGGER.info(`Delete and re-create namespace ${namespace}`);
      try {
        await this.deleteNamespaceAndWait(namespace);
      } catch (err) {
        LOGGER.error(err);
        throw err;
      }
    }

    try {
      const createNamespaceRes = await this.coreV1Api.createNamespace({
        metadata: {
          name: namespace,
        },
      });
      LOGGER.info(`Created namespace ${createNamespaceRes.body.metadata.name}`);
    } catch (err) {
      LOGGER.error(err.body.message);
      throw err;
    }
  }

  async createSecret(secret: k8s.V1Secret, namespace: string) {
    try {
      LOGGER.info(
        `Creating secret ${secret.metadata.name} in namespace ${namespace}`,
      );
      await this.coreV1Api.createNamespacedSecret(namespace, secret);
    } catch (err) {
      LOGGER.error(err.body.message);
      throw err;
    }
  }

  async waitForDeploymentReady(
    deploymentName: string,
    namespace: string,
    expectedReplicas: number,
    timeout: number = 600000, // Increased to 10 minutes
    checkInterval: number = 15000, // Increased to 15 seconds
  ) {
    const start = Date.now();
    const labelSelector =
      "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";

    console.log(
      `Waiting for deployment ${deploymentName} to reach ${expectedReplicas} replicas (timeout: ${timeout / 1000}s)`,
    );

    while (Date.now() - start < timeout) {
      try {
        // Check deployment status
        const response = await this.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );

        const availableReplicas = response.body.status?.availableReplicas || 0;
        const readyReplicas = response.body.status?.readyReplicas || 0;

        console.log(
          `Available replicas: ${availableReplicas}, Ready replicas: ${readyReplicas}`,
        );

        // For zero replicas, just check available replicas
        if (expectedReplicas === 0) {
          if (availableReplicas === 0) {
            console.log(
              `Deployment ${deploymentName} is scaled down to 0 replicas.`,
            );
            return;
          }
        } else {
          // For non-zero replicas, check both available and ready replicas
          if (
            availableReplicas === expectedReplicas &&
            readyReplicas === expectedReplicas
          ) {
            console.log(
              `Deployment ${deploymentName} is ready with ${availableReplicas} replicas.`,
            );
            return;
          }
        }

        // Log pod conditions less frequently to reduce noise
        if ((Date.now() - start) % 60000 < checkInterval) {
          // Every minute
          await this.logPodConditions(namespace, labelSelector);
        }

        console.log(
          `Waiting for ${deploymentName} to reach ${expectedReplicas} replicas, currently has ${availableReplicas} available, ${readyReplicas} ready.`,
        );
      } catch (error) {
        console.error(`Error checking deployment status: ${error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(
      `Deployment ${deploymentName} did not become ready in time (timeout: ${timeout / 1000}s).`,
    );
  }

  async restartDeployment(deploymentName: string, namespace: string) {
    try {
      console.log(
        `Starting deployment restart for ${deploymentName} in namespace ${namespace}`,
      );

      // Scale down deployment to 0 replicas
      console.log(`Scaling down deployment ${deploymentName} to 0 replicas.`);
      await this.scaleDeployment(deploymentName, namespace, 0);
      await this.waitForDeploymentReady(deploymentName, namespace, 0, 300000); // 5 minutes for scale down

      // Wait a bit for pods to be fully terminated
      console.log("Waiting for pods to be fully terminated...");
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds

      // Scale up deployment to 1 replica
      console.log(`Scaling up deployment ${deploymentName} to 1 replica.`);
      await this.scaleDeployment(deploymentName, namespace, 1);
      await this.waitForDeploymentReady(deploymentName, namespace, 1, 600000); // 10 minutes for scale up

      console.log(
        `Restart of deployment ${deploymentName} completed successfully.`,
      );
    } catch (error) {
      console.error(
        `Error during deployment restart: Deployment '${deploymentName}' in namespace '${namespace}'.`,
        error,
      );
      await this.logPodConditions(namespace);
      await this.logDeploymentEvents(deploymentName, namespace);
      throw new Error(
        `Failed to restart deployment '${deploymentName}' in namespace '${namespace}': ${error.message}`,
      );
    }
  }

  async logPodConditions(namespace: string, labelSelector?: string) {
    const selector =
      labelSelector ||
      "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";

    try {
      const response = await this.coreV1Api.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        selector,
      );

      if (response.body.items.length === 0) {
        console.warn(`No pods found for selector: ${selector}`);
      }

      for (const pod of response.body.items) {
        console.log(`Pod: ${pod.metadata?.name}`);
        console.log(
          "Conditions:",
          JSON.stringify(pod.status?.conditions, null, 2),
        );
      }
    } catch (error) {
      console.error(
        `Error while retrieving pod conditions for selector '${selector}':`,
        error,
      );
    }
  }

  async logDeploymentEvents(deploymentName: string, namespace: string) {
    try {
      const eventsResponse = await this.coreV1Api.listNamespacedEvent(
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
        `Error retrieving events for deployment ${deploymentName}: ${error}`,
      );
    }
  }
}
