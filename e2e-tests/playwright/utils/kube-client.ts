import * as k8s from "@kubernetes/client-node";
import { V1ConfigMap } from "@kubernetes/client-node";
import * as yaml from "js-yaml";
import * as stream from "stream";

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
  customObjectsApi: k8s.CustomObjectsApi;
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

        // Check pod conditions for issues
        const conditions = pod.status?.conditions || [];
        for (const condition of conditions) {
          if (
            condition.type === "PodScheduled" &&
            condition.status === "False"
          ) {
            return `Pod ${podName} cannot be scheduled: ${condition.reason} - ${condition.message}`;
          }
          if (
            condition.type === "Ready" &&
            condition.status === "False" &&
            condition.reason &&
            condition.reason !== "ContainersNotReady"
          ) {
            // Only report if it's a specific error reason, not just "not ready yet"
            const errorReasons = [
              "Unhealthy",
              "ReadinessGatesNotReady",
              "PodHasNoResources",
            ];
            if (errorReasons.includes(condition.reason)) {
              return `Pod ${podName} is not ready: ${condition.reason} - ${condition.message}`;
            }
          }
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
              "ErrImageNeverPull",
              "RegistryUnavailable",
            ];

            if (failureStates.includes(reason)) {
              const message = waiting.message || "";
              return `Pod ${podName} container ${containerName} is in ${reason} state: ${message}`;
            }

            // Check for other waiting states that might indicate issues
            if (reason === "ContainerCreating" && waiting.message) {
              // Log but don't fail - this might be normal startup
              console.log(
                `Pod ${podName} container ${containerName} is being created: ${waiting.message}`,
              );
            }
          }

          // Check for containers that have terminated with errors
          const terminated = containerStatus.state?.terminated;
          if (terminated && terminated.exitCode !== 0) {
            const reason = terminated.reason || "Error";
            const message = terminated.message || "";
            // Return error if container exited with non-zero code
            return `Pod ${podName} container ${containerName} terminated with exit code ${terminated.exitCode}: ${reason} - ${message}`;
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
    let lastReplicaSetCheck = 0;
    const replicaSetCheckInterval = 60000; // Check ReplicaSet every 60 seconds

    while (Date.now() < endTime) {
      try {
        const response = await this.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace,
        );
        const availableReplicas = response.body.status?.availableReplicas || 0;
        const readyReplicas = response.body.status?.readyReplicas || 0;
        const updatedReplicas = response.body.status?.updatedReplicas || 0;
        const replicas = response.body.status?.replicas || 0;
        const conditions = response.body.status?.conditions || [];

        console.log(`Available replicas: ${availableReplicas}`);
        console.log(`Ready replicas: ${readyReplicas}`);
        console.log(`Updated replicas: ${updatedReplicas}`);
        console.log(`Desired replicas: ${replicas}`);
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
            await this.logReplicaSetStatus(deploymentName, namespace);
            await this.logPodEvents(namespace, labelSelector);
            await this.logPodConditions(namespace, labelSelector);
            throw new Error(
              `Deployment ${deploymentName} failed to start: ${podFailureReason}`,
            );
          }

          // Periodically check ReplicaSet status if pods aren't being created
          const now = Date.now();
          if (now - lastReplicaSetCheck > replicaSetCheckInterval && availableReplicas === 0) {
            console.log("Checking ReplicaSet status for diagnostic information...");
            await this.logReplicaSetStatus(deploymentName, namespace);
            await this.logPodEvents(namespace, labelSelector);
            await this.logPodConditions(namespace, labelSelector);
            lastReplicaSetCheck = now;
          }
          
          // If pods exist but aren't ready, try to get logs immediately
          if (readyReplicas === 0 && updatedReplicas > 0) {
            // Check for any pods and try to get their logs
            try {
              const podsResponse = await this.coreV1Api.listNamespacedPod(
                namespace,
                undefined,
                undefined,
                undefined,
                undefined,
                labelSelector,
              );
              for (const pod of podsResponse.body.items.slice(0, 2)) {
                const podName = pod.metadata?.name;
                if (!podName) continue;
                const phase = pod.status?.phase;
                // If pod is running but not ready, or if it's failed, get logs
                if (phase === "Running" || phase === "Failed" || phase === "Pending") {
                  try {
                    const logs = await this.coreV1Api.readNamespacedPodLog(
                      podName,
                      namespace,
                      undefined, // container
                      false, // follow
                      undefined, // limitBytes
                      undefined, // pretty
                      undefined, // previous
                      undefined, // sinceSeconds
                      50, // tailLines
                    );
                    if (logs.body) {
                      const logLines = logs.body.split("\n").filter(l => l.trim());
                      if (logLines.length > 0) {
                        console.log(`\n=== Pod ${podName} logs (last ${logLines.length} lines) ===`);
                        logLines.slice(-30).forEach((line) => {
                          console.log(`  ${line}`);
                        });
                        console.log(`=== End of pod ${podName} logs ===\n`);
                      }
                    }
                  } catch (logError) {
                    // Pod might not be ready for logs yet, that's OK
                  }
                }
              }
            } catch (error) {
              // Ignore errors getting pod logs
            }
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
    console.error(`Timeout waiting for deployment ${deploymentName}. Collecting diagnostics...`);
    await this.logDeploymentEvents(deploymentName, namespace);
    await this.logReplicaSetStatus(deploymentName, namespace);
    await this.logPodEvents(namespace, labelSelector);
    await this.logPodConditions(namespace, labelSelector);
    throw new Error(
      `Deployment ${deploymentName} did not become ready in time (timeout: ${timeout / 1000}s). Check the logs above for pod events and ReplicaSet status.`,
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
        return;
      }

      for (const pod of response.body.items) {
        const podName = pod.metadata?.name || "unknown";
        const phase = pod.status?.phase;
        console.log(`Pod: ${podName} (Phase: ${phase})`);
        console.log(
          "Conditions:",
          JSON.stringify(pod.status?.conditions, null, 2),
        );
        
        // Log container statuses
        const containerStatuses = [
          ...(pod.status?.containerStatuses || []),
          ...(pod.status?.initContainerStatuses || []),
        ];
        
        if (containerStatuses.length > 0) {
          console.log("Container Statuses:");
          for (const containerStatus of containerStatuses) {
            const containerName = containerStatus.name;
            const waiting = containerStatus.state?.waiting;
            const running = containerStatus.state?.running;
            const terminated = containerStatus.state?.terminated;
            
            if (waiting) {
              console.log(`  ${containerName}: Waiting - ${waiting.reason}: ${waiting.message}`);
            } else if (running) {
              console.log(`  ${containerName}: Running (started: ${running.startedAt})`);
            } else if (terminated) {
              console.log(`  ${containerName}: Terminated - Exit Code: ${terminated.exitCode}, Reason: ${terminated.reason}`);
              if (terminated.message) {
                console.log(`    Message: ${terminated.message}`);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `Error while retrieving pod conditions for selector '${selector}': ${getKubeApiErrorMessage(error)}`,
      );
    }
  }

  async logPodEvents(namespace: string, labelSelector?: string) {
    const selector =
      labelSelector ||
      "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";

    try {
      // Get all pods (including recently deleted ones if we can)
      const podsResponse = await this.coreV1Api.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        selector,
      );

      // Also try to get pods without selector to catch any pods that might exist
      const allPodsResponse = await this.coreV1Api.listNamespacedPod(
        namespace,
      );

      // Get all events in the namespace
      const eventsResponse = await this.coreV1Api.listNamespacedEvent(
        namespace,
      );

      // Get pod names from both responses
      const podNames = new Set<string>();
      podsResponse.body.items.forEach((pod) => {
        if (pod.metadata?.name) podNames.add(pod.metadata.name);
      });
      allPodsResponse.body.items.forEach((pod) => {
        if (pod.metadata?.name && pod.metadata.name.includes("backstage-developer-hub")) {
          podNames.add(pod.metadata.name);
        }
      });

      // Filter events related to pods (check by name pattern too)
      const podEvents = eventsResponse.body.items
        .filter((event) => {
          const involvedObject = event.involvedObject;
          if (involvedObject?.kind !== "Pod") return false;
          const podName = involvedObject.name;
          // Match if it's in our pod list OR if it matches our deployment pattern
          return (
            podNames.has(podName) ||
            (podName && podName.includes("backstage-developer-hub"))
          );
        })
        .sort((a, b) => {
          // Handle both Date objects and string timestamps
          const getTimestamp = (event: any): number => {
            if (event.firstTimestamp) {
              return typeof event.firstTimestamp === 'string' 
                ? new Date(event.firstTimestamp).getTime() 
                : event.firstTimestamp.getTime();
            }
            if (event.eventTime) {
              return typeof event.eventTime === 'string'
                ? new Date(event.eventTime).getTime()
                : (event.eventTime?.getTime ? event.eventTime.getTime() : 0);
            }
            return 0;
          };
          const aTime = getTimestamp(a);
          const bTime = getTimestamp(b);
          return bTime - aTime; // Most recent first
        })
        .slice(0, 30); // Limit to last 30 events

      if (podEvents.length > 0) {
        console.log(`Recent pod events (last ${podEvents.length}):`);
        for (const event of podEvents) {
          const podName = event.involvedObject?.name || "unknown";
          // Handle both Date objects and string timestamps
          let timestamp = "unknown";
          if (event.firstTimestamp) {
            timestamp = typeof event.firstTimestamp === 'string'
              ? new Date(event.firstTimestamp).toISOString()
              : event.firstTimestamp.toISOString();
          } else if (event.eventTime) {
            timestamp = typeof event.eventTime === 'string'
              ? new Date(event.eventTime).toISOString()
              : (event.eventTime?.toISOString ? event.eventTime.toISOString() : String(event.eventTime));
          }
          console.log(
            `  [${timestamp}] Pod ${podName}: [${event.type}] ${event.reason}: ${event.message}`,
          );
        }
      } else {
        console.log("No recent pod events found");
      }

      // Also try to get logs from any existing pods (even if they're failing)
      if (podsResponse.body.items.length > 0) {
        console.log("\nAttempting to get logs from existing pods:");
        for (const pod of podsResponse.body.items.slice(0, 3)) {
          const podName = pod.metadata?.name;
          if (!podName) continue;
          
          try {
            // Try to get logs (last 50 lines)
            const logs = await this.coreV1Api.readNamespacedPodLog(
              podName,
              namespace,
              undefined, // container name
              undefined, // follow
              undefined, // limitBytes
              undefined, // pretty
              undefined, // previous
              undefined, // sinceSeconds
              undefined, // tailLines
              undefined, // timestamps
            );
            if (logs.body) {
              const logLines = logs.body.split("\n").slice(-20); // Last 20 lines
              console.log(`\n  Pod ${podName} logs (last 20 lines):`);
              logLines.forEach((line) => {
                if (line.trim()) console.log(`    ${line}`);
              });
            }
          } catch (logError) {
            // Pod might be deleted or not ready for logs yet
            console.log(`  Could not get logs from ${podName}: ${getKubeApiErrorMessage(logError)}`);
          }
        }
      }
    } catch (error) {
      console.error(
        `Error retrieving pod events for selector '${selector}': ${getKubeApiErrorMessage(error)}`,
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

  async logReplicaSetStatus(deploymentName: string, namespace: string) {
    try {
      // Get the deployment to find associated ReplicaSets
      const deployment = await this.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace,
      );

      // List ReplicaSets with the deployment's labels
      const labelSelector = deployment.body.spec?.selector?.matchLabels;
      if (!labelSelector) {
        console.warn(`Deployment ${deploymentName} has no label selector`);
        return;
      }

      const selectorString = Object.entries(labelSelector)
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

      const rsResponse = await this.appsApi.listNamespacedReplicaSet(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        selectorString,
      );

      console.log(`Found ${rsResponse.body.items.length} ReplicaSet(s) for deployment ${deploymentName}:`);
      
      // Sort by creation timestamp (newest first)
      const sortedReplicaSets = rsResponse.body.items.sort((a, b) => {
        const aTime = a.metadata?.creationTimestamp?.getTime() || 0;
        const bTime = b.metadata?.creationTimestamp?.getTime() || 0;
        return bTime - aTime;
      });

      for (const rs of sortedReplicaSets) {
        const rsName = rs.metadata?.name || "unknown";
        const readyReplicas = rs.status?.readyReplicas || 0;
        const availableReplicas = rs.status?.availableReplicas || 0;
        const replicas = rs.status?.replicas || 0;
        const fullyLabeledReplicas = rs.status?.fullyLabeledReplicas || 0;
        const conditions = rs.status?.conditions || [];

        console.log(`  ReplicaSet: ${rsName}`);
        console.log(`    Ready: ${readyReplicas}, Available: ${availableReplicas}, Desired: ${replicas}, Fully Labeled: ${fullyLabeledReplicas}`);
        if (conditions.length > 0) {
          console.log(`    Conditions: ${JSON.stringify(conditions, null, 2)}`);
        }

        // Get events for this ReplicaSet
        try {
          const rsEvents = await this.coreV1Api.listNamespacedEvent(
            namespace,
            undefined,
            undefined,
            undefined,
            `involvedObject.name=${rsName}`,
          );
          
          if (rsEvents.body.items.length > 0) {
            console.log(`    Events for ReplicaSet ${rsName}:`);
            rsEvents.body.items.slice(0, 10).forEach((event) => { // Limit to last 10 events
              console.log(`      [${event.type}] ${event.reason}: ${event.message}`);
            });
          } else {
            console.log(`    No events found for ReplicaSet ${rsName}`);
          }
        } catch (error) {
          console.warn(`    Could not retrieve events for ReplicaSet ${rsName}: ${getKubeApiErrorMessage(error)}`);
        }
      }
    } catch (error) {
      console.error(
        `Error retrieving ReplicaSet status for deployment ${deploymentName}: ${getKubeApiErrorMessage(error)}`,
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

  async execPodCommand(
    podName: string,
    namespace: string,
    containerName: string,
    command: string[],
    timeout: number = 60000, // 1 minute
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const exec = new k8s.Exec(this.kc);
      let stdout = "";
      let stderr = "";
      
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Command execution timed out after ${timeout}ms`));
        }, timeout);
        
        // Create writable streams to capture output
        const stdoutStream = new stream.Writable({
          write(chunk: Buffer, encoding: string, callback: () => void) {
            stdout += chunk.toString();
            callback();
          },
        });
        const stderrStream = new stream.Writable({
          write(chunk: Buffer, encoding: string, callback: () => void) {
            stderr += chunk.toString();
            callback();
          },
        });
        
        exec.exec(
          namespace,
          podName,
          containerName,
          command,
          stdoutStream,
          stderrStream,
          process.stdin || undefined,
          false, // tty
          (status: k8s.V1Status) => {
            clearTimeout(timeoutId);
            if (status.status === 'Success') {
              resolve();
            } else {
              reject(new Error(`Command execution failed: ${status.message || stderr || 'unknown error'}`));
            }
          },
        );
      });
      
      return { stdout, stderr };
    } catch (error) {
      throw new Error(`Failed to execute command in pod ${podName}: ${getKubeApiErrorMessage(error)}`);
    }
  }
}
