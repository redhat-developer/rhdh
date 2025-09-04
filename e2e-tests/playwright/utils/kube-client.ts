import * as k8s from "@kubernetes/client-node";
import { V1ConfigMap } from "@kubernetes/client-node";
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
      console.log(e);
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
      console.log(e.body?.message);
      throw e;
    }
  }

  async listConfigMaps(namespace: string) {
    try {
      console.log(`Listing configmaps in namespace ${namespace}`);
      return await this.coreV1Api.listNamespacedConfigMap(namespace);
    } catch (e) {
      console.error(e.body?.message);
      throw e;
    }
  }

  // Define possible ConfigMap base names as a constant
  private readonly appConfigNames = [
    "app-config-rhdh",
    "app-config",
    "backstage-app-config",
    "rhdh-app-config",
  ];

  async findAppConfigMap(namespace: string): Promise<string> {
    try {
      const configMapsResponse = await this.listConfigMaps(namespace);
      const configMaps = configMapsResponse.body.items;

      console.log(
        `Found ${configMaps.length} ConfigMaps in namespace ${namespace}`,
      );
      configMaps.forEach((cm) => {
        console.log(`ConfigMap: ${cm.metadata?.name}`);
      });

      for (const name of this.appConfigNames) {
        const found = configMaps.find((cm) => cm.metadata?.name === name);
        if (found) {
          console.log(`Found app config ConfigMap: ${name}`);
          return name;
        }
      }

      // If none of the expected names found, look for ConfigMaps containing app-config data
      for (const cm of configMaps) {
        if (
          cm.data &&
          Object.keys(cm.data).some(
            (key) => key.includes("app-config") && key.endsWith(".yaml"),
          )
        ) {
          console.log(
            `Found ConfigMap with app-config data: ${cm.metadata?.name}`,
          );
          return cm.metadata?.name || "";
        }
      }

      throw new Error(
        `No suitable app-config ConfigMap found in namespace ${namespace}`,
      );
    } catch (error) {
      console.error(`Error finding app config ConfigMap: ${error}`);
      throw error;
    }
  }

  async getNamespaceByName(name: string): Promise<k8s.V1Namespace | null> {
    try {
      return (await this.coreV1Api.readNamespace(name)).body;
    } catch (e) {
      console.log(`Error getting namespace ${name}: ${e.body?.message}`);
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
      console.log(`Getting secret ${secretName} from namespace ${namespace}`);
      return await this.coreV1Api.readNamespacedSecret(secretName, namespace);
    } catch (e) {
      console.log(e.body.message);
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
      console.log(e.statusCode, e);
      throw e;
    }
  }

  async updateConfigMapTitle(
    configMapName: string,
    namespace: string,
    newTitle: string,
  ) {
    try {
      // If the provided configMapName doesn't exist, try to find the correct one dynamically
      let actualConfigMapName = configMapName;
      try {
        await this.getConfigMap(configMapName, namespace);
        console.log(`Using provided ConfigMap name: ${configMapName}`);
      } catch (error) {
        if (error.response?.statusCode === 404) {
          console.log(
            `ConfigMap ${configMapName} not found, searching for alternatives...`,
          );
          actualConfigMapName = await this.findAppConfigMap(namespace);
        } else {
          throw error;
        }
      }

      const configMapResponse = await this.getConfigMap(
        actualConfigMapName,
        namespace,
      );
      const configMap = configMapResponse.body;

      console.log(`Using ConfigMap: ${actualConfigMapName}`);
      console.log(
        `Available data keys: ${Object.keys(configMap.data || {}).join(", ")}`,
      );

      // Find the correct data key dynamically
      let dataKey: string | undefined;
      const dataKeys = Object.keys(configMap.data || {});

      // Generate key patterns from the possible names + the actual ConfigMap name
      const keyPatterns = [
        `${actualConfigMapName}.yaml`,
        ...this.appConfigNames.map((name) => `${name}.yaml`),
      ];

      for (const pattern of keyPatterns) {
        if (dataKeys.includes(pattern)) {
          dataKey = pattern;
          break;
        }
      }

      // If none of the patterns match, look for any .yaml file containing app-config
      if (!dataKey) {
        dataKey = dataKeys.find(
          (key) => key.endsWith(".yaml") && key.includes("app-config"),
        );
      }

      // Last resort: use any .yaml file
      if (!dataKey) {
        dataKey = dataKeys.find((key) => key.endsWith(".yaml"));
      }

      if (!dataKey) {
        throw new Error(
          `No suitable YAML data key found in ConfigMap '${actualConfigMapName}'. Available keys: ${dataKeys.join(", ")}`,
        );
      }

      console.log(`Using data key: ${dataKey}`);
      const appConfigYaml = configMap.data[dataKey];

      if (!appConfigYaml) {
        throw new Error(
          `Data key '${dataKey}' is empty in ConfigMap '${actualConfigMapName}'`,
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appConfigObj = yaml.load(appConfigYaml) as any;

      if (!appConfigObj || !appConfigObj.app) {
        throw new Error(
          `Invalid app-config structure in ConfigMap '${actualConfigMapName}'. Expected 'app' section not found.`,
        );
      }

      console.log(`Current title: ${appConfigObj.app.title}`);
      appConfigObj.app.title = newTitle;
      console.log(`New title: ${newTitle}`);

      configMap.data[dataKey] = yaml.dump(appConfigObj);

      delete configMap.metadata.creationTimestamp;
      delete configMap.metadata.resourceVersion;

      await this.coreV1Api.replaceNamespacedConfigMap(
        actualConfigMapName,
        namespace,
        configMap,
      );
      console.log(
        `ConfigMap '${actualConfigMapName}' updated successfully with new title: '${newTitle}'`,
      );
    } catch (error) {
      console.error("Error updating ConfigMap:", error);
      throw new Error(`Failed to update ConfigMap: ${error.message}`);
    }
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
      console.log(e.statusCode, e.body.message);
      throw e;
    }
  }

  async createCongifmap(namespace: string, body: V1ConfigMap) {
    try {
      console.log(
        `Creating configmap ${body.metadata.name} in namespace ${namespace}`,
      );
      return await this.coreV1Api.createNamespacedConfigMap(namespace, body);
    } catch (err) {
      console.log(err.body.message);
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
          (err) => {
            if (err && err.statusCode === 404) {
              // Namespace was already deleted or does not exist
              console.log(`Namespace '${namespace}' is already deleted.`);
              resolve();
            } else {
              reject(err);
              throw err;
            }
          },
        );
      });
    } catch (err) {
      console.log("Error deleting or waiting for namespace deletion:", err);
      throw err;
    }
  }

  async createNamespaceIfNotExists(namespace: string) {
    const nsList = await this.coreV1Api.listNamespace();
    const ns = nsList.body.items.map((ns) => ns.metadata.name);
    if (ns.includes(namespace)) {
      console.log(`Delete and re-create namespace ${namespace}`);
      try {
        await this.deleteNamespaceAndWait(namespace);
      } catch (err) {
        console.log(err);
        throw err;
      }
    }

    try {
      const createNamespaceRes = await this.coreV1Api.createNamespace({
        metadata: {
          name: namespace,
        },
      });
      console.log(`Created namespace ${createNamespaceRes.body.metadata.name}`);
    } catch (err) {
      console.log(err.body.message);
      throw err;
    }
  }

  async createSecret(secret: k8s.V1Secret, namespace: string) {
    try {
      console.log(
        `Creating secret ${secret.metadata.name} in namespace ${namespace}`,
      );
      await this.coreV1Api.createNamespacedSecret(namespace, secret);
    } catch (err) {
      console.log(err.body.message);
      throw err;
    }
  }

  async waitForDeploymentReady(
    deploymentName: string,
    namespace: string,
    expectedReplicas: number,
    timeout: number = 300000, // 5 minutes
    checkInterval: number = 10000, // 10 seconds
  ) {
    const endTime = Date.now() + timeout;
    const labelSelector =
      "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";

    while (Date.now() < endTime) {
      try {
        const response = await this.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );
        const availableReplicas = response.body.status?.availableReplicas || 0;
        const readyReplicas = response.body.status?.readyReplicas || 0;
        const conditions = response.body.status?.conditions || [];

        console.log(`Available replicas: ${availableReplicas}`);
        console.log(
          "Deployment conditions:",
          JSON.stringify(conditions, null, 2),
        );

        // Log pod conditions using label selector
        await this.logPodConditions(namespace, labelSelector);

        // Check if the expected replicas match
        if (availableReplicas === expectedReplicas) {
          console.log(
            `Deployment ${deploymentName} is ready with ${availableReplicas} replicas.`,
          );
          return;
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
      console.log(`Deployment: ${deploymentName}, Namespace: ${namespace}`);
      await this.logPodConditions(namespace);
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
        `Error fetching services with label ${labelSelector}:`,
        error,
      );
      throw error;
    }
  }
}
