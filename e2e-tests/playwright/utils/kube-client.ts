import * as k8s from "@kubernetes/client-node";
import { V1ConfigMap } from "@kubernetes/client-node";
import * as yaml from "js-yaml";

/**
 * Interface representing the structure of Kubernetes API errors.
 * Used for type-safe error handling without exposing sensitive data.
 */
interface KubeApiError {
  body?: { message?: string; reason?: string; code?: number };
  statusCode?: number;
  message?: string;
  response?: { statusCode?: number; statusMessage?: string };
}

/**
 * Type guard to check if an unknown error is a KubeApiError.
 */
function isKubeApiError(error: unknown): error is KubeApiError {
  return error !== null && typeof error === "object";
}

/**
 * Safely extracts error information from Kubernetes API errors without leaking sensitive data.
 * The @kubernetes/client-node HttpError contains the full HTTP request/response which includes
 * the Authorization header with the bearer token. This function extracts only safe information.
 */
function getKubeApiErrorMessage(error: unknown): string {
  if (isKubeApiError(error)) {
    const err = error;

    // Kubernetes API errors have a body with message, reason, and code
    if (err.body?.message) {
      const parts = [err.body.message];
      if (err.body.reason) parts.push(`reason: ${err.body.reason}`);
      if (err.body.code) parts.push(`code: ${err.body.code}`);
      return parts.join(", ");
    }

    // Fallback to statusCode and statusMessage from response
    if (err.response?.statusCode) {
      return `HTTP ${err.response.statusCode}: ${err.response.statusMessage || "Unknown error"}`;
    }

    // Fallback to statusCode on error object
    if (err.statusCode) {
      return `HTTP ${err.statusCode}`;
    }

    // Fallback to error message (safe as it doesn't contain request details)
    if (err.message) {
      return err.message;
    }
  }

  return "Unknown Kubernetes API error";
}

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
      console.error(
        `Error finding app config ConfigMap: ${getKubeApiErrorMessage(error)}`,
      );
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
    maxRetries: number = 3,
  ) {
    const patch = { spec: { replicas: replicas } };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
            headers: {
              "Content-Type": "application/strategic-merge-patch+json",
            },
          },
        );
        console.log(
          `Deployment ${deploymentName} scaled to ${replicas} replicas.`,
        );
        return;
      } catch (error) {
        const statusCode = error.response?.statusCode || error.statusCode;
        const isNotFound = statusCode === 404;
        const isRetryable =
          isNotFound || statusCode === 503 || statusCode === 429;

        if (isRetryable && attempt < maxRetries) {
          const delay = attempt * 2000; // 2s, 4s, 6s, 8s...
          console.log(
            `Deployment ${deploymentName} not ready (${statusCode}). Retry ${attempt}/${maxRetries} after ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error(
            `Failed to scale deployment ${deploymentName} after ${attempt} attempts:`,
            error.body?.message || error.message,
          );
          throw error;
        }
      }
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
      console.log(`Error updating configmap: ${getKubeApiErrorMessage(e)}`);
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
      console.error(
        `Error updating ConfigMap: ${getKubeApiErrorMessage(error)}`,
      );
      throw new Error(
        `Failed to update ConfigMap: ${getKubeApiErrorMessage(error)}`,
      );
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
      console.log(
        `Error deleting or waiting for namespace deletion: ${getKubeApiErrorMessage(err)}`,
      );
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

  /**
   * Create or update a Kubernetes secret (upsert pattern).
   * Tries to update the secret first; if it doesn't exist, creates it.
   */
  async createOrUpdateSecret(
    secret: k8s.V1Secret,
    namespace: string,
  ): Promise<void> {
    const secretName = secret.metadata?.name;
    const patch = { data: secret.data };

    try {
      // Try to update existing secret
      await this.updateSecret(secretName, namespace, patch);
      console.log(`Secret ${secretName} updated in namespace ${namespace}`);
    } catch {
      // Secret doesn't exist, create it
      console.log(
        `Secret ${secretName} not found, creating in namespace ${namespace}`,
      );
      await this.createSecret(secret, namespace);
      console.log(`Secret ${secretName} created in namespace ${namespace}`);
    }
  }

  /**
   * Check if pods are in a failure state (CrashLoopBackOff, ImagePullBackOff, etc.)
   * Returns a failure reason if found, null otherwise
   */
  async checkPodFailureStates(
    namespace: string,
    labelSelector: string,
  ): Promise<string | null> {
    try {
      const response = await this.coreV1Api.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector,
      );

      const pods = response.body.items;
      if (pods.length === 0) {
        return null; // No pods yet, not a failure
      }

      for (const pod of pods) {
        const podName = pod.metadata?.name || "unknown";
        const phase = pod.status?.phase;

        // Check for Failed phase
        if (phase === "Failed") {
          const reason = pod.status?.reason || "Unknown";
          const message = pod.status?.message || "";
          return `Pod ${podName} is in Failed phase: ${reason} - ${message}`;
        }

        // Check container statuses for failure states
        const containerStatuses = [
          ...(pod.status?.containerStatuses || []),
          ...(pod.status?.initContainerStatuses || []),
        ];

        for (const containerStatus of containerStatuses) {
          const containerName = containerStatus.name;
          const waiting = containerStatus.state?.waiting;

          if (waiting) {
            const reason = waiting.reason || "";
            // Check for common failure states
            const failureStates = [
              "CrashLoopBackOff",
              "ImagePullBackOff",
              "ErrImagePull",
              "InvalidImageName",
              "CreateContainerConfigError",
              "CreateContainerError",
            ];

            if (failureStates.includes(reason)) {
              const message = waiting.message || "";
              return `Pod ${podName} container ${containerName} is in ${reason} state: ${message}`;
            }
          }

          // Check for containers that have terminated with errors
          const terminated = containerStatus.state?.terminated;
          if (terminated && terminated.exitCode !== 0) {
            const reason = terminated.reason || "Error";
            const message = terminated.message || "";
            console.warn(
              `Pod ${podName} container ${containerName} terminated with exit code ${terminated.exitCode}: ${reason} - ${message}`,
            );
          }
        }
      }

      return null; // No failure states detected
    } catch (error) {
      console.error(
        `Error checking pod failure states: ${getKubeApiErrorMessage(error)}`,
      );
      return null; // Don't fail the check if we can't retrieve pod info
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

        // Check for pod failure states when expecting replicas > 0
        if (expectedReplicas > 0) {
          const podFailureReason = await this.checkPodFailureStates(
            namespace,
            labelSelector,
          );
          if (podFailureReason) {
            console.error(
              `Pod failure detected: ${podFailureReason}. Logging events and pod logs...`,
            );
            await this.logDeploymentEvents(deploymentName, namespace);
            throw new Error(
              `Deployment ${deploymentName} failed to start: ${podFailureReason}`,
            );
          }
        }

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
        console.error(
          `Error checking deployment status: ${getKubeApiErrorMessage(error)}`,
        );
        // If we threw an error about pod failure, re-throw it
        if (error.message?.includes("failed to start")) {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    // On timeout, collect final diagnostics
    await this.logDeploymentEvents(deploymentName, namespace);
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
        `Error during deployment restart: Deployment '${deploymentName}' in namespace '${namespace}': ${getKubeApiErrorMessage(error)}`,
      );
      await this.logPodConditions(namespace);
      await this.logDeploymentEvents(deploymentName, namespace);
      throw new Error(
        `Failed to restart deployment '${deploymentName}' in namespace '${namespace}': ${getKubeApiErrorMessage(error)}`,
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
        `Error while retrieving pod conditions for selector '${selector}': ${getKubeApiErrorMessage(error)}`,
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
        `Error retrieving events for deployment ${deploymentName}: ${getKubeApiErrorMessage(error)}`,
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
        `Error fetching services with label ${labelSelector}: ${getKubeApiErrorMessage(error)}`,
      );
      throw error;
    }
  }
}
