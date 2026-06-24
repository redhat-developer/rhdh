import { ChildProcess, spawn } from "child_process";
import { promises as fs } from "fs";
import { join, resolve as resolvePath } from "path";
import stream from "stream";

import { GroupEntity, UserEntity } from "@backstage/catalog-model";
import * as k8s from "@kubernetes/client-node";
import { expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import * as yaml from "yaml";

import { APIHelper } from "../api-helper";
import { getErrorMessage, hasErrorResponse } from "../errors";

type YamlConfig = Record<string, unknown>;

interface DynamicPluginConfig {
  package: string;
  disabled?: boolean;
}

type DynamicPluginsConfig = Record<string, unknown> & {
  plugins: DynamicPluginConfig[];
};

interface BackstageCrSpec {
  replicas?: number;
  deployment?: unknown;
}

interface BackstageCr {
  apiVersion: string;
  kind: string;
  metadata: { name: string };
  spec: BackstageCrSpec;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(() => {
      resolvePromise();
    }, ms);
  });
}

function isRecord(value: unknown): value is YamlConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackstageCr(value: unknown): value is BackstageCr {
  return (
    isRecord(value) &&
    typeof value.apiVersion === "string" &&
    typeof value.kind === "string" &&
    isRecord(value.metadata) &&
    typeof value.metadata.name === "string" &&
    isRecord(value.spec)
  );
}

function isDynamicPluginsConfig(value: unknown): value is DynamicPluginsConfig {
  if (!isRecord(value)) {
    return false;
  }
  const { plugins } = value;
  return (
    plugins === undefined ||
    (Array.isArray(plugins) &&
      plugins.every((plugin) => isRecord(plugin) && typeof plugin.package === "string"))
  );
}

function isUserEntity(value: unknown): value is UserEntity {
  return isRecord(value) && value.kind === "User";
}

function isGroupEntity(value: unknown): value is GroupEntity {
  return isRecord(value) && value.kind === "Group";
}

function getCatalogUsers(response: unknown): UserEntity[] {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    return [];
  }
  return response.items.filter(isUserEntity);
}

function getCatalogGroups(response: unknown): GroupEntity[] {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    return [];
  }
  return response.items.filter(isGroupEntity);
}

const currentDirName = import.meta.dirname;
const rootDirName = resolvePath(currentDirName, "..", "..", "..", "..");
const syncedLogRegex =
  /(Committed \d+ (Keycloak|msgraph|GitHub|LDAP|GitLab) users? and \d+ (Keycloak|msgraph|GitHub|LDAP|GitLab) groups? in \d+(\.\d+)? seconds|Scanned \d+ users? and processed \d+ users?)/;

class RHDHDeployment {
  instanceName!: string;
  private kc!: k8s.KubeConfig;
  private k8sApi!: k8s.CoreV1Api;
  private appsV1Api!: k8s.AppsV1Api;
  private namespace: string;
  private appConfigMap: string;
  private rbacConfigMap: string;
  private dynamicPluginsConfigMap: string;
  private secretName: string;
  private appConfig: YamlConfig = {};
  private dynamicPluginsConfig: DynamicPluginsConfig = { plugins: [] };
  private rbacConfig: string = "";
  private secretData: Record<string, string> = {};
  private isRunningLocal: boolean = false;
  private runningProcess: ChildProcess | null = null;
  private staticToken: string = "";
  private cr: BackstageCr = {
    apiVersion: "",
    kind: "",
    metadata: { name: "" },
    spec: {},
  };
  private configReconcileBaselineGeneration: number | undefined;

  constructor(
    namespace: string,
    appConfigMap: string,
    rbacConfigMap: string,
    dynamicPluginsConfigMap: string,
    secretName: string,
  ) {
    if (!process.env.ISRUNNINGLOCAL || process.env.ISRUNNINGLOCAL === "false") {
      this.kc = new k8s.KubeConfig();
      this.kc.loadFromDefault();
      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.appsV1Api = this.kc.makeApiClient(k8s.AppsV1Api);
    }
    this.namespace = namespace;
    this.appConfigMap = appConfigMap;
    this.rbacConfigMap = rbacConfigMap;
    this.dynamicPluginsConfigMap = dynamicPluginsConfigMap;
    this.secretName = secretName;
    this.isRunningLocal = process.env.ISRUNNINGLOCAL === "true";
  }

  async addSecretData(key: string, value: string): Promise<RHDHDeployment> {
    if (value.length === 0) {
      throw new Error("Value cannot be empty");
    }
    if (key.length === 0) {
      throw new Error("Key cannot be empty");
    }
    if (this.isRunningLocal) {
      process.env[key] = value;
    }
    this.secretData[key] = Buffer.from(value).toString("base64");
    return this;
  }

  async removeSecretData(key: string): Promise<RHDHDeployment> {
    if (key.length === 0) {
      throw new Error("Key cannot be empty");
    }
    if (key in this.secretData) {
      delete this.secretData[key];
    }
    return this;
  }

  async createNamespace(): Promise<RHDHDeployment> {
    // Skip namespace creation if running locally
    if (this.isRunningLocal) {
      console.log("Skipping namespace creation as isRunningLocal is true.");
      return this;
    }

    const namespaceObj: k8s.V1Namespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: this.namespace,
      },
    };

    try {
      await this.k8sApi.createNamespace(namespaceObj);
      return this;
    } catch (e) {
      if (hasErrorResponse(e) && e.response?.statusCode === 409) {
        return this;
      }
      throw e;
    }
  }

  async deleteNamespaceIfExists(timeoutMs: number = 60000): Promise<RHDHDeployment> {
    // Skip namespace deletion if running locally
    if (this.isRunningLocal) {
      console.log("Skipping namespace deletion as isRunningLocal is true.");
      return this;
    }

    try {
      await this.k8sApi.deleteNamespace(this.namespace);

      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        try {
          await this.k8sApi.readNamespace(this.namespace);
          await sleep(1000);
        } catch (error) {
          if (hasErrorResponse(error) && error.response?.statusCode === 404) {
            return this;
          }
          throw error;
        }
      }
      throw new Error(`Timeout waiting for namespace to be deleted after ${timeoutMs}ms`);
    } catch (e) {
      if (hasErrorResponse(e) && e.response?.statusCode === 404) {
        return this;
      }
      throw e;
    }
  }

  setConfigProperty(config: Record<string, unknown>, path: string, value: unknown): RHDHDeployment {
    const parts = path.split(".");
    let current: Record<string, unknown> = config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) {
        throw new Error(`Invalid config path: ${path}`);
      }
      if (!(part in current)) {
        current[part] = {};
      }
      if (!isRecord(current[part])) {
        current[part] = {};
      }
      const next = current[part];
      if (!isRecord(next)) {
        throw new Error(`Invalid config path: ${path}`);
      }
      current = next;
    }

    const lastPart = parts.at(-1);
    if (lastPart === undefined) {
      throw new Error(`Invalid config path: ${path}`);
    }
    current[lastPart] = value;

    return this;
  }

  getConfig<T extends Record<string, unknown>>(config: T): T {
    return config;
  }

  setAppConfigProperty(path: string, value: unknown): RHDHDeployment {
    return this.setConfigProperty(this.appConfig, path, value);
  }

  getAppConfig(): YamlConfig {
    return this.getConfig(this.appConfig);
  }

  setDynamicPluginsConfigProperty(path: string, value: unknown): RHDHDeployment {
    return this.setConfigProperty(this.dynamicPluginsConfig, path, value);
  }

  getDynamicPluginsConfig(): DynamicPluginsConfig {
    return this.dynamicPluginsConfig;
  }

  async loadBaseConfig(): Promise<RHDHDeployment> {
    const configPath = join(currentDirName, "yamls", "configmap.yaml");
    const yamlContent = await fs.readFile(configPath, "utf8");
    const configData: unknown = yaml.parse(yamlContent);

    if (isRecord(configData)) {
      this.appConfig = configData;
    }

    return this;
  }

  async applyCustomResource(resource: BackstageCr): Promise<RHDHDeployment> {
    console.log("Applying CR.");
    try {
      const customObjectsApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
      await customObjectsApi.createNamespacedCustomObject(
        resource.apiVersion.split("/")[0],
        resource.apiVersion.split("/")[1],
        this.namespace,
        resource.kind.toLowerCase() + "s",
        resource,
      );
      return this;
    } catch (e) {
      console.error(JSON.stringify(e));
      throw e;
    }
  }

  async readYamlToJson(filePath: string): Promise<unknown> {
    const fileContent = await fs.readFile(filePath, "utf8");
    return yaml.parse(fileContent);
  }

  async createConfigMap(name: string, data: Record<string, string>): Promise<RHDHDeployment> {
    const configMap: k8s.V1ConfigMap = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: name,
        namespace: this.namespace,
      },
      data: data,
    };
    await this.k8sApi.createNamespacedConfigMap(this.namespace, configMap);
    return this;
  }

  async updateConfigMap(name: string, data: Record<string, string>): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      console.log("Skipping configmap update as isRunningLocal is true.");
      return this;
    }

    const patch = [
      {
        op: "replace",
        path: "/data",
        value: data,
      },
    ];

    await this.k8sApi.patchNamespacedConfigMap(
      name,
      this.namespace,
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/json-patch+json" } },
    );
    return this;
  }

  async createAppConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const appConfigPath = join(currentDirName, "app-config.test.yaml"); // Path to the local file
      const appConfigYaml = yaml.stringify(this.appConfig); // Stringify the appConfig
      await fs.writeFile(appConfigPath, appConfigYaml, "utf8"); // Write the stringified YAML to the local file
      console.log(`App config written to ${appConfigPath}`);
      return this;
    }

    const appConfig = {
      "app-config.yaml": yaml.stringify(this.appConfig),
    };
    await this.createConfigMap(this.appConfigMap, appConfig);
    return this;
  }

  async updateAppConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const appConfigPath = join(currentDirName, "app-config.test.yaml"); // Path to the local file
      const appConfigYaml = yaml.stringify(this.appConfig); // Stringify the appConfig
      await fs.writeFile(appConfigPath, appConfigYaml, "utf8"); // Write the stringified YAML to the local file
      console.log(`App config updated in ${appConfigPath}`);
      return this;
    }

    const appConfig = {
      "app-config.yaml": yaml.stringify(this.appConfig),
    };
    await this.updateConfigMap(this.appConfigMap, appConfig);
    return this;
  }

  async deleteConfigMap(): Promise<RHDHDeployment> {
    await this.k8sApi.deleteNamespacedConfigMap(this.appConfigMap, this.namespace);
    return this;
  }

  async createSecret(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      console.log("Skipping secret creation as isRunningLocal is true.");
      return this;
    }
    const secret: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: this.secretName,
        namespace: this.namespace,
      },
      data: this.secretData,
    };
    await this.k8sApi.createNamespacedSecret(this.namespace, secret);
    return this;
  }

  async updateSecret(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      console.log("Skipping secret update as isRunningLocal is true.");
      return this;
    }
    const secret: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: this.secretName,
        namespace: this.namespace,
      },
      data: this.secretData,
    };
    await this.k8sApi.replaceNamespacedSecret(this.secretName, this.namespace, secret);
    return this;
  }

  async deleteSecret(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      console.log("Skipping secret deletion as isRunningLocal is true.");
      return this;
    }
    await this.k8sApi.deleteNamespacedSecret(this.secretName, this.namespace);
    return this;
  }

  private async getDeploymentGeneration(): Promise<number> {
    const labels = {
      "app.kubernetes.io/name": "backstage",
      "app.kubernetes.io/instance": this.instanceName,
    };
    const labelSelector = Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    const deployments = await this.appsV1Api.listNamespacedDeployment(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector,
    );

    if (deployments.body.items.length === 0) {
      throw new Error(`No deployment found with labels: ${labelSelector}`);
    }

    return deployments.body.items[0].metadata?.generation ?? 0;
  }

  async waitForConfigReconciled(timeoutMs: number = 60000): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      return this;
    }

    const baseline =
      this.configReconcileBaselineGeneration ?? (await this.getDeploymentGeneration());
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const currentGeneration = await this.getDeploymentGeneration();
      if (currentGeneration > baseline) {
        console.log(
          `[INFO] Config reconciled - deployment generation ${baseline} -> ${currentGeneration}`,
        );
        return this;
      }
      await sleep(1000);
    }

    console.log(`[INFO] No deployment generation change after ${timeoutMs}ms, proceeding`);
    return this;
  }

  async waitForDeploymentReady(timeoutMs: number = 600000): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      console.log("Skipping deployment ready check as isRunningLocal is true.");
      return this;
    }
    const startTime = Date.now();
    const labels = {
      "app.kubernetes.io/name": "backstage",
      "app.kubernetes.io/instance": this.instanceName,
    };
    const labelSelector = Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    // First, capture the initial deployment state to detect when rollout starts
    let initialGeneration: number | undefined;
    let rolloutStarted = false;
    const rolloutStartTimeout = 60000; // Wait up to 60 seconds for rollout to start

    while (Date.now() - startTime < timeoutMs) {
      try {
        const deployments = await this.appsV1Api.listNamespacedDeployment(
          this.namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          labelSelector,
        );

        if (deployments.body.items.length === 0) {
          throw new Error(`No deployment found with labels: ${labelSelector}`);
        }

        const deployment = deployments.body.items[0];
        const conditions = deployment.status?.conditions || [];

        // Capture initial generation on first check
        if (initialGeneration === undefined) {
          initialGeneration = deployment.metadata?.generation || 0;
          console.log(`[INFO] Initial deployment generation: ${initialGeneration}`);
        }

        // Check if rollout has started (generation changed or progressing condition indicates rollout)
        const currentGeneration = deployment.metadata?.generation || 0;
        const observedGeneration = deployment.status?.observedGeneration || 0;
        const isProgressing = conditions.some(
          (condition) => condition.type === "Progressing" && condition.status === "True",
        );

        // Rollout has started if:
        // 1. Generation increased (new spec applied)
        // 2. Observed generation is less than current generation (rollout in progress)
        // 3. Progressing condition is true
        if (
          !rolloutStarted &&
          (currentGeneration > initialGeneration ||
            observedGeneration < currentGeneration ||
            isProgressing)
        ) {
          rolloutStarted = true;
          console.log(
            `[INFO] Rollout detected - Generation: ${currentGeneration}, Observed: ${observedGeneration}`,
          );
        }

        // If we haven't detected rollout start yet, wait a bit and check again
        // This handles the delay between configmap update and Kubernetes detecting the change
        if (!rolloutStarted) {
          const elapsedSinceStart = Date.now() - startTime;
          if (elapsedSinceStart < rolloutStartTimeout) {
            console.log(
              `[INFO] Waiting for rollout to start... (${Math.round(elapsedSinceStart / 1000)}s elapsed)`,
            );
            await sleep(2000); // Check every 2 seconds
            continue;
          } else {
            // If no rollout detected but deployment is ready, assume no restart was needed
            console.log(
              `[INFO] No rollout detected after ${rolloutStartTimeout}ms, checking if deployment is already ready`,
            );
            rolloutStarted = true; // Proceed to check readiness
          }
        }

        const isAvailable = conditions.some(
          (condition) => condition.type === "Available" && condition.status === "True",
        );

        const isProgressingWithRollout = conditions.some(
          (condition) =>
            condition.type === "Progressing" &&
            condition.status === "True" &&
            condition.reason !== "NewReplicaSetAvailable",
        );

        const replicas = deployment.spec?.replicas;
        const desiredReplicas = this.cr.spec.replicas ? this.cr.spec.replicas : 1;

        // Check replica counts to ensure rollout has completed
        const availableReplicas = deployment.status?.availableReplicas || 0;
        const readyReplicas = deployment.status?.readyReplicas || 0;
        const updatedReplicas = deployment.status?.updatedReplicas || 0;

        const replicasMatch =
          availableReplicas === desiredReplicas &&
          readyReplicas === desiredReplicas &&
          updatedReplicas === desiredReplicas;

        // Deployment is ready when:
        // - Available condition is true
        // - Not progressing (or only NewReplicaSetAvailable which is fine)
        // - All replica counts match
        if (
          isAvailable &&
          !isProgressingWithRollout &&
          replicas == desiredReplicas &&
          replicasMatch &&
          observedGeneration >= currentGeneration
        ) {
          await sleep(5000);
          return this;
        } else if (isProgressingWithRollout || !replicasMatch) {
          console.log(
            `[INFO] Deployment is progressing - Available: ${availableReplicas}, Ready: ${readyReplicas}, Updated: ${updatedReplicas}, Desired: ${desiredReplicas}, Observed Gen: ${observedGeneration}/${currentGeneration}`,
          );
        }

        await sleep(5000);
      } catch (error) {
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(`Timeout waiting for deployment to be ready: ${getErrorMessage(error)}`, {
            cause: error,
          });
        }
        await sleep(5000);
      }
    }

    throw new Error(`Timeout waiting for deployment to be ready after ${timeoutMs}ms`);
  }

  async waitForNamespaceActive(timeoutMs: number = 30000): Promise<RHDHDeployment> {
    const startTime = Date.now();
    if (this.isRunningLocal) {
      console.log("Skipping namespace active check as isRunningLocal is true.");
      return this;
    }

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await this.k8sApi.readNamespace(this.namespace);
        const phase = response.body.status?.phase;

        if (phase === "Active") {
          return this;
        }

        await sleep(1000);
      } catch (error) {
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(`Timeout waiting for namespace to be active: ${getErrorMessage(error)}`, {
            cause: error,
          });
        }
        await sleep(1000);
      }
    }

    throw new Error(`Timeout waiting for namespace to be active after ${timeoutMs}ms`);
  }

  async loadRbacConfig(): Promise<RHDHDeployment> {
    const configPath = join(currentDirName, "yamls", "rbac-policy.csv");
    this.rbacConfig = await fs.readFile(configPath, "utf8"); // Load CSV content directly
    return this;
  }

  async createRbacConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const rbacConfigPath = join(currentDirName, "rbac.test.csv"); // Path to the local file
      await fs.writeFile(rbacConfigPath, this.rbacConfig, "utf8"); // Write the RBAC config to the local file
      console.log(`RBAC config written to ${rbacConfigPath}`);
      return this;
    }

    await this.createConfigMap(this.rbacConfigMap, {
      "rbac-policy.csv": this.rbacConfig,
    });
    return this;
  }

  async updateRbacConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const rbacConfigPath = join(currentDirName, "rbac.test.csv"); // Path to the local file
      await fs.writeFile(rbacConfigPath, this.rbacConfig, "utf8"); // Write the RBAC config to the local file
      console.log(`RBAC config updated in ${rbacConfigPath}`);
      return this;
    }

    await this.updateConfigMap(this.rbacConfigMap, {
      "rbac-policy.csv": this.rbacConfig,
    });
    return this;
  }

  appendRbacLine(newLine: string): RHDHDeployment {
    this.rbacConfig += `\n${newLine}`;
    return this;
  }

  replaceInRbacConfig(regex: RegExp, replacement: string): RHDHDeployment {
    this.rbacConfig = this.rbacConfig.replace(regex, replacement);
    return this;
  }

  async loadDynamicPluginsConfig(): Promise<RHDHDeployment> {
    const configPath = join(currentDirName, "yamls", "dynamic-plugins-config.yaml");
    const yamlContent = await fs.readFile(configPath, "utf8");
    const configData: unknown = yaml.parse(yamlContent);

    if (isDynamicPluginsConfig(configData)) {
      this.dynamicPluginsConfig = configData;
    }

    return this;
  }

  async createDynamicPluginsConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const dynamicPluginsConfigPath = join(currentDirName, "dynamic-plugins.test.yaml"); // Path to the local file
      const dynamicPluginsConfigYaml = yaml.stringify(this.dynamicPluginsConfig); // Stringify the dynamic plugins config
      await fs.writeFile(dynamicPluginsConfigPath, dynamicPluginsConfigYaml, "utf8"); // Write the stringified YAML to the local file
      console.log(`Dynamic plugins config written to ${dynamicPluginsConfigPath}`);
      this.setAppConfigProperty(
        "dynamicPlugins.rootDirectory",
        rootDirName + "/dynamic-plugins-root",
      );
      await this.updateAppConfig();
      return this;
    }

    await this.createConfigMap(this.dynamicPluginsConfigMap, {
      "dynamic-plugins.yaml": yaml.stringify(this.dynamicPluginsConfig),
    });
    return this;
  }

  async updateDynamicPluginsConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const dynamicPluginsConfigPath = join(currentDirName, "dynamic-plugins.test.yaml"); // Path to the local file
      const dynamicPluginsConfigYaml = yaml.stringify(this.dynamicPluginsConfig); // Stringify the dynamic plugins config
      await fs.writeFile(dynamicPluginsConfigPath, dynamicPluginsConfigYaml, "utf8"); // Write the stringified YAML to the local file
      console.log(`Dynamic plugins config updated in ${dynamicPluginsConfigPath}`);
      console.log(
        `Dynamic plugins config in ${dynamicPluginsConfigPath} has no effect on local deployment. Make sure to update the app-config.test.yaml file to use the dynamic-plugins-root directory and your plugin are already copied there.`,
      );
      return this;
    }

    await this.updateConfigMap(this.dynamicPluginsConfigMap, {
      "dynamic-plugins.yaml": yaml.stringify(this.dynamicPluginsConfig),
    });
    return this;
  }

  async loadBackstageCR(): Promise<BackstageCr> {
    const configPath = join(currentDirName, "yamls", "backstage.yaml");
    const parsed: unknown = await this.readYamlToJson(configPath);
    if (!isBackstageCr(parsed)) {
      throw new Error("Invalid Backstage CR config");
    }
    const backstageConfig = parsed;
    const imageRegistry = process.env.IMAGE_REGISTRY || "quay.io";
    const imageRepo = process.env.IMAGE_REPO || process.env.QUAY_REPO;
    const tagName = process.env.TAG_NAME;
    expect(imageRepo, "IMAGE_REPO or QUAY_REPO must be set").toBeTruthy();
    expect(tagName, "TAG_NAME must be set").toBeTruthy();
    const image = `${imageRegistry}/${imageRepo}:${tagName}`;
    backstageConfig.spec.deployment = {
      patch: {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: "backstage-backend",
                  image,
                  imagePullPolicy: "Always",
                },
              ],
            },
          },
        },
      },
    };
    console.log(`Setting Backstage CR image via deployment.patch to ${image}`);
    this.cr = backstageConfig;
    this.instanceName = backstageConfig.metadata.name;
    return backstageConfig;
  }

  async ensureBackstageCRIsAvailable(timeoutMs: number = 60000): Promise<void> {
    if (this.isRunningLocal) {
      console.log("Skipping CRD check as isRunningLocal is true.");
      return;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const customObjectsApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
        await customObjectsApi.getClusterCustomObject(
          "apiextensions.k8s.io",
          "v1",
          "customresourcedefinitions",
          "backstages.rhdh.redhat.com",
        );
        return;
      } catch (error) {
        console.log(`Timeout waiting for Backstage CRD to be available: ${getErrorMessage(error)}`);
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(
            `Timeout waiting for Backstage CRD to be available: ${getErrorMessage(error)}`,
            { cause: error },
          );
        }
        await sleep(5000);
      }
    }
    throw new Error(`Timeout waiting for Backstage CRD to be available after ${timeoutMs}ms`);
  }

  async createBackstageDeployment(): Promise<RHDHDeployment> {
    try {
      if (this.isRunningLocal) {
        this.runningProcess = spawn(
          "yarn",
          [
            "dev",
            "--env-mode=loose",
            "--",
            "--config",
            currentDirName + "/app-config.test.yaml",
            "--config",
            currentDirName + "/dynamic-plugins.test.yaml",
          ],
          {
            shell: true,
            cwd: resolvePath(rootDirName),
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
          },
        );
        this.runningProcess.unref();
        console.log(`Local production server started with PID: ${this.runningProcess.pid}`);
        return this;
      }
      await this.ensureBackstageCRIsAvailable(60000);
      const backstageConfig = await this.loadBackstageCR();
      await this.applyCustomResource(backstageConfig);
      await this.waitForDeploymentReady();
      return this;
    } catch (e) {
      console.log(JSON.stringify(e));
      throw e;
    }
  }

  async killRunningProcess(): Promise<void> {
    if (this.runningProcess?.pid) {
      const killed = process.kill(-this.runningProcess.pid);
      console.log("Local production server process killed?", killed);

      // Wait for the process to actually terminate with a 5-second timeout
      await new Promise<void>((resolvePromise) => {
        this.runningProcess?.on("exit", () => {
          setTimeout(() => {
            console.log("Process termination timeout reached after 5 seconds.");
            this.runningProcess = null;
            resolvePromise();
          }, 5000);
        });
      });

      // Verify homepage is not accessible
      const baseUrl = await this.computeBackstageUrl();
      try {
        const response = await fetch(baseUrl, { method: "HEAD" });
        if (response.status === 200) {
          throw new Error("Homepage is still accessible after process termination");
        }
      } catch (error) {
        // Expected error - connection refused
        console.log("Homepage is not accessible as expected: ", error);
      }
    } else {
      console.log("No running process to kill.");
    }
  }

  async followPodLogs(
    searchString: RegExp,
    podName?: string,
    podLabels?: Record<string, string>,
    timeoutMs: number = 300000,
  ): Promise<boolean> {
    const namespace = this.namespace;
    if (!podName && podLabels) {
      try {
        const labelSelector = Object.entries(podLabels)
          .map(([key, value]) => `${key}=${value}`)
          .join(",");

        const pods = await this.k8sApi.listNamespacedPod(
          namespace,
          undefined,
          undefined,
          undefined,
          "status.phase=Running",
          labelSelector,
        );

        if (pods.body.items.length === 0) {
          throw new Error(`No pod found with labels: ${labelSelector}`);
        }

        // Filter out pods in terminating phase
        const activePods = pods.body.items.filter((pod) => {
          const isTerminating = pod.metadata?.deletionTimestamp !== undefined;
          return !isTerminating;
        });

        if (activePods.length === 0) {
          throw new Error(`No active pods found with labels: ${labelSelector}`);
        }

        const pod = activePods[0];
        podName = pod.metadata!.name!;
      } catch (error) {
        throw new Error(`Error getting pod name: ${getErrorMessage(error)}`, {
          cause: error,
        });
      }
    }

    try {
      console.log(`Reading logs for pod ${podName}`);
      const startTime = Date.now();
      let found = false;
      const log = new k8s.Log(this.kc);
      const logStream = new stream.PassThrough();

      logStream.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString();
        if (searchString.test(text)) {
          process.stdout.write(chunk);
          found = true;
        }
      });

      logStream.on("error", (error) => {
        throw new Error(`Error getting pod name: ${getErrorMessage(error)}`);
      });

      logStream.on("end", () => {
        console.log("Log stream ended.");
      });

      await log.log(namespace, podName!, "backstage-backend", logStream, {
        follow: true,
        tailLines: 1,
        pretty: false,
        timestamps: false,
      });

      // Keep the function alive to allow streaming

      while (Date.now() - startTime < timeoutMs) {
        if (found) {
          break;
        }
        await sleep(1000);
      }
      if (found) {
        logStream.end();
        logStream.removeAllListeners();
      }
      return found;
    } catch (error) {
      const message = hasErrorResponse(error) ? error.body?.message : getErrorMessage(error);
      console.log(`Error: ${message}`);
      throw new Error(
        `Timeout waiting for string "${searchString}" in logs after ${timeoutMs}ms. Error: ${message}`,
        { cause: error },
      );
    }
  }

  async followLocalLogs(searchString: RegExp, timeoutMs: number = 30000): Promise<boolean> {
    if (!this.isRunningLocal) {
      throw new Error("Not running in local mode. Cannot follow local logs.");
    }

    let found = false;

    console.log(
      "Following logs from the local production server. Looking for string: ",
      searchString,
    );

    // Create a readable stream from the running process's stdout
    const logStream = new stream.PassThrough();

    // Pipe the stdout of the running process to the logStream
    this.runningProcess?.stdout?.pipe(logStream);

    logStream.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      if (process.env.ISRUNNINGLOCAL && process.env.ISRUNNINGLOCALDEBUG) {
        console.log(`\t${text.replaceAll(/\n/g, "\t")}`);
      }
      if (searchString.test(text)) {
        console.log("Found string in local logs.");
        found = true;
      }
    });

    logStream.on("error", (error) => {
      throw new Error(`Error reading local logs: ${getErrorMessage(error)}`);
    });

    logStream.on("end", () => {
      console.log("Local log stream ended.");
    });

    // Keep the function alive to allow streaming
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (found) {
        break;
      }
      await sleep(1000);
    }

    return found;
  }

  async followLogs(searchString: RegExp, timeoutMs: number = 300000): Promise<boolean> {
    if (this.isRunningLocal) {
      return this.followLocalLogs(searchString, timeoutMs);
    }
    return this.followPodLogs(
      searchString,
      undefined,
      { "rhdh.redhat.com/app": `backstage-${this.instanceName}` },
      timeoutMs,
    );
  }

  async computeBackstageUrl(): Promise<string> {
    if (this.isRunningLocal) {
      return `http://localhost:3000`;
    }
    const cluster = this.kc.getCurrentCluster();
    if (!cluster || !cluster.server) {
      throw new Error("Unable to retrieve cluster information.");
    }
    const regex = /^https?:\/\/(?:api\.)?([^:/]+)/;
    const match = cluster.server.match(regex);
    let clusterBaseUrl = "";
    if (match) {
      clusterBaseUrl = match[1];
    } else {
      console.log("No match found.");
    }
    return `https://backstage-${this.instanceName}-${this.namespace}.apps.${clusterBaseUrl}`;
  }

  async computeBackstageBackendUrl() {
    if (this.isRunningLocal) {
      return `http://localhost:7007`;
    }
    return this.computeBackstageUrl();
  }

  async loadAllConfigs(): Promise<RHDHDeployment> {
    // Load base config if defined
    if (this.appConfigMap) {
      await this.loadBaseConfig();
    }

    // Load dynamic plugins config if defined
    if (this.dynamicPluginsConfigMap) {
      await this.loadDynamicPluginsConfig();
    }

    // Load RBAC config if defined
    if (this.rbacConfigMap) {
      await this.loadRbacConfig();
    }

    // Load Backstage CR
    await this.loadBackstageCR();

    return this;
  }

  async checkBaseUrlReachable(): Promise<boolean> {
    const baseUrl = await this.computeBackstageUrl();
    try {
      const response = await fetch(baseUrl, { method: "HEAD" });
      return response.status === 200;
    } catch (error: unknown) {
      console.log(`Error: ${getErrorMessage(error)}`);
      return false;
    }
  }

  async expectBaseUrlReachable(): Promise<void> {
    const isReachable = await this.checkBaseUrlReachable();
    expect(isReachable).toBe(true);
  }

  // TODO: Enable Github
  // TODO: ENABLE RBAC
  // TODO: Enable Redis

  // New method to enable or disable a dynamic plugin

  setDynamicPluginEnabled(pluginName: string, enabled: boolean): RHDHDeployment {
    const plugin = this.dynamicPluginsConfig.plugins.find((p) => p.package === pluginName);
    if (plugin) {
      plugin.disabled = !enabled;
      console.log(`Plugin ${pluginName} has been ${enabled ? "enabled" : "disabled"}.`);
    } else {
      this.dynamicPluginsConfig.plugins = [
        ...this.dynamicPluginsConfig.plugins,
        {
          package: pluginName,
          disabled: !enabled,
        },
      ];
      console.log(
        `Plugin ${pluginName} has been added to the dynamic plugins config and set to ${enabled ? "enabled" : "disabled"}.`,
      );
    }
    return this;
  }

  printDynamicPluginsConfig(): void {
    console.log(yaml.stringify(this.dynamicPluginsConfig.plugins));
  }

  async enableOIDCLoginWithIngestion(): Promise<RHDHDeployment> {
    console.log("Enabling OIDC login with ingestion...");
    //expect the config variable to be set
    expect(process.env.RHBK_BASE_URL).toBeDefined();
    expect(process.env.RHBK_REALM).toBeDefined();
    expect(process.env.RHBK_CLIENT_ID).toBeDefined();
    expect(process.env.RHBK_CLIENT_SECRET).toBeDefined();

    // enable the catalog backend dynamic plugin
    // and set the required configuration properties
    this.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-community-plugin-catalog-backend-module-keycloak-dynamic",
      true,
    );
    this.setAppConfigProperty("catalog.providers", {
      keycloakOrg: {
        default: {
          baseUrl: "${RHBK_BASE_URL}",
          loginRealm: "${RHBK_REALM}",
          realm: "${RHBK_REALM}",
          clientId: "${RHBK_CLIENT_ID}",
          clientSecret: "${RHBK_CLIENT_SECRET}",
          schedule: {
            frequency: {
              minutes: 1,
            },
            timeout: {
              minutes: 1,
            },
          },
        },
      },
    });

    // enable the keycloak login provider
    this.setAppConfigProperty("auth.providers.oidc", {
      production: {
        metadataUrl: "${RHBK_BASE_URL}/realms/${RHBK_REALM}",
        clientId: "${RHBK_CLIENT_ID}",
        clientSecret: "${RHBK_CLIENT_SECRET}",
        prompt: "auto",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/oidc/handler/frame",
      },
    });
    this.setAppConfigProperty("auth.environment", "production");
    this.setAppConfigProperty("signInPage", "oidc");

    return this;
  }

  async enablePingFederateOIDCLogin(): Promise<RHDHDeployment> {
    console.log("Enabling PingFederate OIDC login...");

    // Expect the config variables to be set
    expect(process.env.PINGFEDERATE_BASE_URL).toBeDefined();
    expect(process.env.PINGFEDERATE_CLIENT_ID).toBeDefined();
    expect(process.env.PINGFEDERATE_CLIENT_SECRET).toBeDefined();

    // Enable the PingFederate OIDC login provider
    this.setAppConfigProperty("auth.providers.oidc", {
      production: {
        metadataUrl: "${PINGFEDERATE_BASE_URL}/.well-known/openid-configuration",
        clientId: "${PINGFEDERATE_CLIENT_ID}",
        clientSecret: "${PINGFEDERATE_CLIENT_SECRET}",
        prompt: "auto",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/oidc/handler/frame",
      },
    });
    this.setAppConfigProperty("auth.environment", "production");
    this.setAppConfigProperty("signInPage", "oidc");

    return this;
  }

  async enableLDAPLoginWithIngestion(): Promise<RHDHDeployment> {
    console.log("Enabling LDAP login with ingestion...");
    //expect the config variable to be set
    expect(process.env.RHBK_BASE_URL).toBeDefined();
    expect(process.env.RHBK_LDAP_REALM).toBeDefined();
    expect(process.env.RHBK_LDAP_CLIENT_ID).toBeDefined();
    expect(process.env.RHBK_LDAP_CLIENT_SECRET).toBeDefined();

    // enable the catalog backend dynamic plugin
    // and set the required configuration properties
    this.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-ldap-dynamic",
      true,
    );
    this.setAppConfigProperty("catalog.providers", {
      ldapOrg: {
        default: {
          target: "${LDAP_TARGET_URL}",
          bind: {
            dn: "${LDAP_BIND_DN}",
            secret: "${LDAP_BIND_SECRET}",
          },
          users: [
            {
              dn: "${LDAP_USERS_DN}",
              options: {
                filter: "(uid=*)",
                scope: "sub",
              },
            },
          ],
          groups: [
            {
              dn: "${LDAP_GROUPS_DN}",
              options: {
                filter: "(&(objectClass=group)(groupType:1.2.840.113556.1.4.803:=2147483648))", // filter only security groups
                scope: "sub",
              },
            },
          ],
          schedule: {
            frequency: "PT1M",
            timeout: "PT1M",
          },
        },
      },
    });

    // enable the keycloak login provider
    this.setAppConfigProperty("auth.providers.oidc", {
      production: {
        metadataUrl: "${RHBK_BASE_URL}/realms/${RHBK_LDAP_REALM}",
        clientId: "${RHBK_LDAP_CLIENT_ID}",
        clientSecret: "${RHBK_LDAP_CLIENT_SECRET}",
        prompt: "auto",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/oidc/handler/frame",
      },
    });
    this.setAppConfigProperty("auth.environment", "production");
    this.setAppConfigProperty("signInPage", "oidc");

    return this;
  }

  async enableMicrosoftLoginWithIngestion(): Promise<RHDHDeployment> {
    console.log("Enabling Microsoft login with ingestion...");
    //expect the config variable to be set
    expect(process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_AZURE_TENANT_ID).toBeDefined();

    // enable the catalog backend dynamic plugin
    // and set the required configuration properties
    this.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-msgraph-dynamic",
      true,
    );
    this.setAppConfigProperty("catalog.providers", {
      microsoftGraphOrg: {
        default: {
          target: "https://graph.microsoft.com/v1.0",
          authority: "https://login.microsoftonline.com",
          tenantId: "${AUTH_PROVIDERS_AZURE_TENANT_ID}",
          clientId: "${AUTH_PROVIDERS_AZURE_CLIENT_ID}",
          clientSecret: "${AUTH_PROVIDERS_AZURE_CLIENT_SECRET}",
          user: {
            filter:
              "accountEnabled eq true and userType eq 'member' and startswith(displayName,'TEST')",
          },
          group: {
            filter:
              "securityEnabled eq true and mailEnabled eq false and startswith(displayName,'TEST_')\n",
          },
          schedule: {
            frequency: "PT1M",
            timeout: "PT1M",
          },
        },
      },
    });

    // enable the keycloak login provider
    this.setAppConfigProperty("auth.providers.microsoft", {
      production: {
        clientId: "${AUTH_PROVIDERS_AZURE_CLIENT_ID}",
        clientSecret: "${AUTH_PROVIDERS_AZURE_CLIENT_SECRET}",
        prompt: "auto",
        tenantId: "${AUTH_PROVIDERS_AZURE_TENANT_ID}",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/microsoft/handler/frame",
      },
    });
    this.setAppConfigProperty("auth.environment", "production");
    this.setAppConfigProperty("signInPage", "microsoft");

    return this;
  }

  async enableGithubLoginWithIngestion(): Promise<RHDHDeployment> {
    console.log("Enabling Github login with ingestion...");

    //expect the config variable to be set
    expect(process.env.AUTH_PROVIDERS_GH_ORG_NAME).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_APP_ID).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET).toBeDefined();

    // enable the catalog backend dynamic plugin
    // and set the required configuration properties
    this.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-org-dynamic",
      true,
    );
    // Use local path for local development, OCI path for CI/CD
    const transformerPluginPath = this.isRunningLocal
      ? "./dynamic-plugins/dist/@internal/backstage-plugin-catalog-backend-module-github-org-transformer-dynamic"
      : "oci://quay.io/rh-ee-jhe/catalog-github-org-transformer:v0.3.0!internal-backstage-plugin-catalog-backend-module-github-org-transformer";

    this.setDynamicPluginEnabled(transformerPluginPath, true);

    this.setAppConfigProperty("catalog.providers", {
      githubOrg: [
        {
          id: "github",
          githubUrl: "https://github.com",
          orgs: ["${AUTH_PROVIDERS_GH_ORG_NAME}"],
          schedule: {
            initialDelay: {
              seconds: 0,
            },
            frequency: {
              minutes: 1,
            },
            timeout: {
              minutes: 1,
            },
          },
        },
      ],
    });

    // enable github integration
    this.setAppConfigProperty("integrations", {
      github: [
        {
          host: "github.com",
          apps: [
            {
              appId: "${AUTH_PROVIDERS_GH_ORG_APP_ID}",
              clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
              clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
              privateKey: "${AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY}",
              webhookSecret: "${AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET}",
            },
          ],
        },
      ],
    });

    // enable the github login provider
    this.setAppConfigProperty("auth.providers.github", {
      production: {
        clientId: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}",
        clientSecret: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/github/handler/frame",
      },
    });

    this.setAppConfigProperty("auth.environment", "production");
    this.setAppConfigProperty("signInPage", "github");

    return this;
  }

  async createAllConfigs(): Promise<RHDHDeployment> {
    await this.createAppConfig();
    await this.createDynamicPluginsConfig();
    await this.createRbacConfig();
    return this;
  }

  async updateAllConfigs(): Promise<RHDHDeployment> {
    if (!this.isRunningLocal) {
      this.configReconcileBaselineGeneration = await this.getDeploymentGeneration();
    }
    await this.updateAppConfig();
    await this.updateDynamicPluginsConfig();
    await this.updateRbacConfig();

    return this;
  }

  async restartLocalDeployment(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      console.log("Restarting local deployment...");
      await this.killRunningProcess();

      await this.createBackstageDeployment();
    }
    return this;
  }

  async generateStaticToken(): Promise<RHDHDeployment> {
    const token = uuidv4();
    await this.addSecretData("STATIC_TOKEN", token);
    this.staticToken = token;
    return this;
  }

  getCurrentStaticToken(): string {
    return this.staticToken;
  }

  async setOIDCResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
  ): Promise<RHDHDeployment> {
    this.setAppConfigProperty("auth.providers.oidc.production.signIn.resolvers", [
      {
        resolver: resolver,
        dangerouslyAllowSignInWithoutUserInCatalog: dangerouslyAllowSignInWithoutUserInCatalog,
      },
    ]);
    return this;
  }

  async setMicrosoftResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
  ): Promise<RHDHDeployment> {
    this.setAppConfigProperty("auth.providers.microsoft.production.signIn.resolvers", [
      {
        resolver: resolver,
        dangerouslyAllowSignInWithoutUserInCatalog: dangerouslyAllowSignInWithoutUserInCatalog,
      },
    ]);
    return this;
  }

  async setGithubResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
  ): Promise<RHDHDeployment> {
    this.setAppConfigProperty("auth.providers.github.production.signIn.resolvers", [
      {
        resolver: resolver,
        dangerouslyAllowSignInWithoutUserInCatalog: dangerouslyAllowSignInWithoutUserInCatalog,
      },
    ]);
    return this;
  }

  async enableGitlabLoginWithIngestion(): Promise<RHDHDeployment> {
    console.log("Enabling GitLab login with ingestion...");

    //expect the config variable to be set
    expect(process.env.AUTH_PROVIDERS_GITLAB_HOST).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GITLAB_TOKEN).toBeDefined();
    expect(process.env.AUTH_PROVIDERS_GITLAB_PARENT_ORG).toBeDefined();

    // enable the catalog backend dynamic plugin
    // and set the required configuration properties
    this.setDynamicPluginEnabled(
      "./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-gitlab-org-dynamic",
      true,
    );

    this.setAppConfigProperty("catalog.providers", {
      gitlab: {
        default: {
          host: "${AUTH_PROVIDERS_GITLAB_HOST}",
          orgEnabled: true,
          group: "${AUTH_PROVIDERS_GITLAB_PARENT_ORG}",
          restrictUsersToGroup: true,
          includeUsersWithoutSeat: true,
          schedule: {
            initialDelay: {
              seconds: 0,
            },
            frequency: {
              minutes: 1,
            },
            timeout: {
              minutes: 1,
            },
          },
        },
      },
    });

    // enable gitlab integration
    this.setAppConfigProperty("integrations", {
      gitlab: [
        {
          host: "${AUTH_PROVIDERS_GITLAB_HOST}",
          token: "${AUTH_PROVIDERS_GITLAB_TOKEN}",
          apiBaseUrl: "https://${AUTH_PROVIDERS_GITLAB_HOST}/api/v4",
        },
      ],
    });

    // enable the gitlab login provider
    this.setAppConfigProperty("auth.providers.gitlab", {
      production: {
        audience: "https://${AUTH_PROVIDERS_GITLAB_HOST}",
        clientId: "${AUTH_PROVIDERS_GITLAB_CLIENT_ID}",
        clientSecret: "${AUTH_PROVIDERS_GITLAB_CLIENT_SECRET}",
        callbackUrl: "${BASE_URL:-http://localhost:7007}/api/auth/gitlab/handler/frame",
      },
    });

    this.setAppConfigProperty("auth.environment", "production");
    this.setAppConfigProperty("signInPage", "gitlab");

    return this;
  }

  async setGitlabResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
  ): Promise<RHDHDeployment> {
    this.setAppConfigProperty("auth.providers.gitlab.production.signIn.resolvers", [
      {
        resolver: resolver,
        dangerouslyAllowSignInWithoutUserInCatalog: dangerouslyAllowSignInWithoutUserInCatalog,
      },
    ]);
    return this;
  }

  async waitForSynced(): Promise<RHDHDeployment> {
    const synced = await this.followLogs(syncedLogRegex, 120000);
    expect(synced).toBe(true);
    await sleep(2000);
    return this;
  }

  parseGroupMemberFromEntity(group: GroupEntity): string[] {
    if (!group.relations) {
      return [];
    }
    return group.relations
      .filter((r) => r.type === "hasMember")
      .map((r) => r.targetRef.split("/")[1]);
  }

  parseGroupChildrenFromEntity(group: GroupEntity): string[] {
    if (!group.relations) {
      return [];
    }
    return group.relations
      .filter((r) => r.type === "parentOf")
      .map((r) => r.targetRef.split("/")[1]);
  }

  parseGroupParentFromEntity(group: GroupEntity): string[] {
    if (!group.relations) {
      return [];
    }
    return group.relations
      .filter((r) => r.type === "childOf")
      .map((r) => r.targetRef.split("/")[1]);
  }

  async checkUserIsIngestedInCatalog(users: string[]): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const response: unknown = await api.getAllCatalogUsersFromAPI();
    const catalogUsers = getCatalogUsers(response);
    expect(catalogUsers.length).toBeGreaterThan(0);
    const catalogUsersDisplayNames: string[] = catalogUsers
      .map((u) => u.spec.profile?.displayName)
      .filter((name): name is string => name !== undefined);
    console.log(
      `Checking ${JSON.stringify(catalogUsersDisplayNames)} contains users ${JSON.stringify(users)}`,
    );
    const hasAllElems = users.every((elem) => catalogUsersDisplayNames.includes(elem));
    return hasAllElems;
  }

  async checkGroupIsIngestedInCatalog(groups: string[]): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const response: unknown = await api.getAllCatalogGroupsFromAPI();
    const catalogGroups = getCatalogGroups(response);
    expect(catalogGroups.length).toBeGreaterThan(0);
    const catalogGroupsDisplayNames: string[] = catalogGroups
      .map((u) => u.spec.profile?.displayName)
      .filter((name): name is string => name !== undefined);
    console.log(
      `Checking ${JSON.stringify(catalogGroupsDisplayNames)} contains groups ${JSON.stringify(groups)}`,
    );
    const hasAllElems = groups.every((elem) => catalogGroupsDisplayNames.includes(elem));
    return hasAllElems;
  }

  async checkUserIsInGroup(user: string, group: string): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const entity: unknown = await api.getGroupEntityFromAPI(group);
    if (!isGroupEntity(entity)) {
      throw new Error(`Invalid group entity for ${group}`);
    }
    const members = this.parseGroupMemberFromEntity(entity);
    console.log(`Checking group ${group} (${JSON.stringify(members)}) contains user ${user}`);
    return members.includes(user);
  }

  async checkGroupIsParentOfGroup(parent: string, child: string): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const entity: unknown = await api.getGroupEntityFromAPI(parent);
    if (!isGroupEntity(entity)) {
      throw new Error(`Invalid group entity for ${parent}`);
    }
    const children = this.parseGroupChildrenFromEntity(entity);
    console.log(
      `Checking children of ${parent} (${JSON.stringify(children)}) contain group ${child}`,
    );
    return children.includes(child);
  }

  async checkGroupIsChildOfGroup(child: string, parent: string): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const entity: unknown = await api.getGroupEntityFromAPI(child);
    if (!isGroupEntity(entity)) {
      throw new Error(`Invalid group entity for ${child}`);
    }
    const parents = this.parseGroupParentFromEntity(entity);
    console.log(
      `Checking parents of ${child} (${JSON.stringify(parents)}) contain group ${parent}`,
    );
    return parents.includes(parent);
  }

  async checkUserHasAnnotation(
    user: string,
    annotationKey: string,
    expectedValue: string,
  ): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const entity: unknown = await api.getCatalogUserFromAPI(user);
    if (!isUserEntity(entity)) {
      throw new Error(`Invalid user entity for ${user}`);
    }
    const annotations = entity.metadata?.annotations || {};
    const actualValue = annotations[annotationKey];
    console.log(
      `Checking user ${user} has annotation ${annotationKey}=${expectedValue}, actual value: ${actualValue}`,
    );
    return actualValue === expectedValue;
  }
}

export default RHDHDeployment;
