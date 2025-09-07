/* eslint-disable @typescript-eslint/no-explicit-any */
import * as k8s from "@kubernetes/client-node";
import * as yaml from "yaml";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import stream from "stream";
import { expect } from "@playwright/test";
import { ChildProcess, spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { APIHelper } from "../api-helper";
import { GroupEntity, UserEntity } from "@backstage/catalog-model";

const currentFileName = fileURLToPath(import.meta.url);
const currentDirName = dirname(currentFileName);
const rootDirName = resolve(currentDirName, "..", "..", "..", "..");
const syncedLogRegex =
  /Committed \d+ (Keycloak|msgraph|GitHub|LDAP) users? and \d+ (Keycloak|msgraph|GitHub|LDAP) groups? in \d+(\.\d+)? seconds/;

class RHDHDeployment {
  instanceName: string;
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private appsV1Api: k8s.AppsV1Api;
  private namespace: string;
  private appConfigMap: string;
  private rbacConfigMap: string;
  private dynamicPluginsConfigMap: string;
  private secretName: string;
  private appConfig: any = {};
  private dynamicPluginsConfig: any = {};
  private rbacConfig: string = "";
  private secretData: any = {};
  private isRunningLocal: boolean = false;
  private runningProcess: ChildProcess | null = null;
  private staticToken: string = "";
  private cr: any = {};

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
      if (e.response?.statusCode === 409) {
        return this;
      }
      throw e;
    }
  }

  async deleteNamespaceIfExists(
    timeoutMs: number = 60000,
  ): Promise<RHDHDeployment> {
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
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          if (error.response?.statusCode === 404) {
            return this;
          }
          throw error;
        }
      }
      throw new Error(
        `Timeout waiting for namespace to be deleted after ${timeoutMs}ms`,
      );
    } catch (e) {
      if (e.response?.statusCode === 404) {
        return this;
      }
      throw e;
    }
  }

  setConfigProperty(config: any, path: string, value: unknown): RHDHDeployment {
    const parts = path.split(".");
    let current = config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;

    return this;
  }

  getConfig(config: any): any {
    return config;
  }

  setAppConfigProperty(path: string, value: unknown): RHDHDeployment {
    return this.setConfigProperty(this.appConfig, path, value);
  }

  getAppConfig(): any {
    return this.getConfig(this.appConfig);
  }

  setDynamicPluginsConfigProperty(
    path: string,
    value: unknown,
  ): RHDHDeployment {
    return this.setConfigProperty(this.dynamicPluginsConfig, path, value);
  }

  getDynamicPluginsConfig(): any {
    return this.getConfig(this.dynamicPluginsConfig);
  }

  async loadBaseConfig(): Promise<RHDHDeployment> {
    const configPath = join(currentDirName, "yamls", "configmap.yaml");
    const yamlContent = await fs.readFile(configPath, "utf8");
    const configData = yaml.parse(yamlContent);

    if (configData) {
      this.appConfig = configData;
    }

    return this;
  }

  async applyCustomResource(resource: any): Promise<RHDHDeployment> {
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

  async readYamlToJson(filePath: string): Promise<any> {
    const fileContent = await fs.readFile(filePath, "utf8");
    return yaml.parse(fileContent);
  }

  async createConfigMap(name: string, data: any): Promise<RHDHDeployment> {
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

  async updateConfigMap(name: string, data: any): Promise<RHDHDeployment> {
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
    await this.k8sApi.deleteNamespacedConfigMap(
      this.appConfigMap,
      this.namespace,
    );
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
    await this.k8sApi.replaceNamespacedSecret(
      this.secretName,
      this.namespace,
      secret,
    );
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

  async waitForDeploymentReady(
    timeoutMs: number = 600000,
  ): Promise<RHDHDeployment> {
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

        const isAvailable = conditions.some(
          (condition) =>
            condition.type === "Available" && condition.status === "True",
        );

        const isProgressing = conditions.some(
          (condition) =>
            condition.type === "Progressing" &&
            condition.status === "True" &&
            condition.reason !== "NewReplicaSetAvailable",
        );

        const replicas = deployment.spec.replicas;
        const desiredReplicas = this.cr.spec.replicas
          ? this.cr.spec.replicas
          : 1;
        if (isAvailable && !isProgressing && replicas == desiredReplicas) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return this;
        } else if (isProgressing) {
          console.log(`[INFO] Deployment is progressing (${replicas})`);
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error) {
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(
            `Timeout waiting for deployment to be ready: ${error.message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    throw new Error(
      `Timeout waiting for deployment to be ready after ${timeoutMs}ms`,
    );
  }

  async waitForNamespaceActive(
    timeoutMs: number = 30000,
  ): Promise<RHDHDeployment> {
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

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(
            `Timeout waiting for namespace to be active: ${error.message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error(
      `Timeout waiting for namespace to be active after ${timeoutMs}ms`,
    );
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
    const configPath = join(
      currentDirName,
      "yamls",
      "dynamic-plugins-config.yaml",
    );
    const yamlContent = await fs.readFile(configPath, "utf8");
    const configData = yaml.parse(yamlContent);

    if (configData) {
      this.dynamicPluginsConfig = configData;
    }

    return this;
  }

  async createDynamicPluginsConfig(): Promise<RHDHDeployment> {
    if (this.isRunningLocal) {
      const dynamicPluginsConfigPath = join(
        currentDirName,
        "dynamic-plugins.test.yaml",
      ); // Path to the local file
      const dynamicPluginsConfigYaml = yaml.stringify(
        this.dynamicPluginsConfig,
      ); // Stringify the dynamic plugins config
      await fs.writeFile(
        dynamicPluginsConfigPath,
        dynamicPluginsConfigYaml,
        "utf8",
      ); // Write the stringified YAML to the local file
      console.log(
        `Dynamic plugins config written to ${dynamicPluginsConfigPath}`,
      );
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
      const dynamicPluginsConfigPath = join(
        currentDirName,
        "dynamic-plugins.test.yaml",
      ); // Path to the local file
      const dynamicPluginsConfigYaml = yaml.stringify(
        this.dynamicPluginsConfig,
      ); // Stringify the dynamic plugins config
      await fs.writeFile(
        dynamicPluginsConfigPath,
        dynamicPluginsConfigYaml,
        "utf8",
      ); // Write the stringified YAML to the local file
      console.log(
        `Dynamic plugins config updated in ${dynamicPluginsConfigPath}`,
      );
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

  async loadBackstageCR(): Promise<unknown> {
    const configPath = join(currentDirName, "yamls", "backstage.yaml");
    const backstageConfig = await this.readYamlToJson(configPath);
    expect(process.env.QUAY_REPO).toBeDefined();
    expect(process.env.TAG_NAME).toBeDefined();
    backstageConfig.spec.application.image = `quay.io/${process.env.QUAY_REPO}:${process.env.TAG_NAME}`;
    console.log(
      `Setting Backstage CR image to quay.io/${process.env.QUAY_REPO}:${process.env.TAG_NAME}`,
    );
    this.cr = backstageConfig;
    this.instanceName = backstageConfig.metadata.name.toString();
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
        console.log(
          `Timeout waiting for Backstage CRD to be available: ${error.message}`,
        );
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(
            `Timeout waiting for Backstage CRD to be available: ${error.message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    throw new Error(
      `Timeout waiting for Backstage CRD to be available after ${timeoutMs}ms`,
    );
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
            cwd: resolve(rootDirName),
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
          },
        );
        this.runningProcess.unref();
        console.log(
          `Local production server started with PID: ${this.runningProcess.pid}`,
        );
        return this;
      }
      await this.ensureBackstageCRIsAvailable(60000);
      const backstageConfig: any = await this.loadBackstageCR();
      await this.applyCustomResource(backstageConfig);
      await this.waitForDeploymentReady();
      return this;
    } catch (e) {
      console.log(JSON.stringify(e));
      throw e;
    }
  }

  async killRunningProcess(): Promise<void> {
    if (this.runningProcess) {
      const killed = process.kill(-this.runningProcess.pid);
      console.log("Local production server process killed?", killed);

      // Wait for the process to actually terminate with a 5-second timeout
      await new Promise<void>((resolve) => {
        this.runningProcess?.on("exit", () => {
          setTimeout(() => {
            console.log("Process termination timeout reached after 5 seconds.");
            this.runningProcess = null;
            resolve();
          }, 5000);
        });
      });

      // Verify homepage is not accessible
      const baseUrl = await this.computeBackstageUrl();
      try {
        const response = await fetch(baseUrl, { method: "HEAD" });
        if (response.status === 200) {
          throw new Error(
            "Homepage is still accessible after process termination",
          );
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
    podLabels?: any,
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
        throw new Error(`Error getting pod name: ${error.message}`);
      }
    }

    try {
      console.log(`Reading logs for pod ${podName}`);
      const startTime = Date.now();
      let found = false;
      const log = new k8s.Log(this.kc);
      const logStream = new stream.PassThrough();

      logStream.on("data", (chunk) => {
        if (searchString.test(chunk.toString())) {
          process.stdout.write(chunk);
          found = true;
        }
      });

      logStream.on("error", (error) => {
        throw new Error(`Error getting pod name: ${error.message}`);
      });

      logStream.on("end", () => {
        console.log("Log stream ended.");
      });

      await log.log(namespace, podName, "backstage-backend", logStream, {
        follow: true,
        tailLines: 1,
        pretty: false,
        timestamps: false,
      });

      // Keep the function alive to allow streaming

      while (Date.now() - startTime < timeoutMs && !found) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (found) {
        logStream.end();
        logStream.removeAllListeners();
      }
      return found;
    } catch (error) {
      console.log(`Error: ${error.body.message}`);
      throw new Error(
        `Timeout waiting for string "${searchString}" in logs after ${timeoutMs}ms. Error: ${error.body.message}`,
      );
    }
  }

  async followLocalLogs(
    searchString: RegExp,
    timeoutMs: number = 30000,
  ): Promise<boolean> {
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

    logStream.on("data", (chunk) => {
      if (process.env.ISRUNNINGLOCAL && process.env.ISRUNNINGLOCALDEBUG) {
        console.log(`\t${chunk.toString().replace(/\n/g, "\t")}`);
      }
      if (searchString.test(chunk.toString())) {
        console.log("Found string in local logs.");
        found = true;
      }
    });

    logStream.on("error", (error) => {
      throw new Error(`Error reading local logs: ${error.message}`);
    });

    logStream.on("end", () => {
      console.log("Local log stream ended.");
    });

    // Keep the function alive to allow streaming
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs && !found) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return found;
  }

  async followLogs(
    searchString: RegExp,
    timeoutMs: number = 300000,
  ): Promise<boolean> {
    if (this.isRunningLocal) {
      return this.followLocalLogs(searchString, timeoutMs);
    } else {
      return this.followPodLogs(
        searchString,
        undefined,
        { "rhdh.redhat.com/app": `backstage-${this.instanceName}` },
        timeoutMs,
      );
    }
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
    return await this.computeBackstageUrl();
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
      console.log(`Error: ${(error as Error).message}`);
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

  setDynamicPluginEnabled(
    pluginName: string,
    enabled: boolean,
  ): RHDHDeployment {
    const plugin = this.dynamicPluginsConfig.plugins.find(
      (p: any) => p.package == pluginName,
    );
    if (plugin) {
      plugin.disabled = !enabled;
      console.log(
        `Plugin ${pluginName} has been ${enabled ? "enabled" : "disabled"}.`,
      );
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
        callbackUrl:
          "${BASE_URL:-http://localhost:7007}/api/auth/oidc/handler/frame",
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
                filter:
                  "(&(objectClass=group)(groupType:1.2.840.113556.1.4.803:=2147483648))", // filter only security groups
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
        callbackUrl:
          "${BASE_URL:-http://localhost:7007}/api/auth/oidc/handler/frame",
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
        callbackUrl:
          "${BASE_URL:-http://localhost:7007}/api/auth/microsoft/handler/frame",
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
        callbackUrl:
          "${BASE_URL:-http://localhost:7007}/api/auth/github/handler/frame",
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
    this.setAppConfigProperty(
      "auth.providers.oidc.production.signIn.resolvers",
      [
        {
          resolver: resolver,
          dangerouslyAllowSignInWithoutUserInCatalog:
            dangerouslyAllowSignInWithoutUserInCatalog,
        },
      ],
    );
    return this;
  }

  async setMicrosoftResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
  ): Promise<RHDHDeployment> {
    this.setAppConfigProperty(
      "auth.providers.microsoft.production.signIn.resolvers",
      [
        {
          resolver: resolver,
          dangerouslyAllowSignInWithoutUserInCatalog:
            dangerouslyAllowSignInWithoutUserInCatalog,
        },
      ],
    );
    return this;
  }

  async setGithubResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog: boolean = false,
  ): Promise<RHDHDeployment> {
    this.setAppConfigProperty(
      "auth.providers.github.production.signIn.resolvers",
      [
        {
          resolver: resolver,
          dangerouslyAllowSignInWithoutUserInCatalog:
            dangerouslyAllowSignInWithoutUserInCatalog,
        },
      ],
    );
    return this;
  }

  async waitForSynced(): Promise<RHDHDeployment> {
    const synced = await this.followLogs(syncedLogRegex, 120000);
    expect(synced).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return this;
  }

  parseGroupMemberFromEntity(group: GroupEntity) {
    if (!group.relations) {
      return [];
    }
    return group.relations
      .filter((r) => {
        if (r.type == "hasMember") {
          return true;
        }
      })
      .map((r) => r.targetRef.split("/")[1]);
  }

  parseGroupChildrenFromEntity(group: GroupEntity) {
    if (!group.relations) {
      return [];
    }
    return group.relations
      .filter((r) => {
        if (r.type == "parentOf") {
          return true;
        }
      })
      .map((r) => r.targetRef.split("/")[1]);
  }

  parseGroupParentFromEntity(group: GroupEntity) {
    if (!group.relations) {
      return [];
    }
    return group.relations
      .filter((r) => {
        if (r.type == "childOf") {
          return true;
        }
      })
      .map((r) => r.targetRef.split("/")[1]);
  }

  async checkUserIsIngestedInCatalog(users: string[]) {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const response = await api.getAllCatalogUsersFromAPI();
    const catalogUsers: UserEntity[] =
      response && response.items ? response.items : [];
    expect(catalogUsers.length).toBeGreaterThan(0);
    const catalogUsersDisplayNames: string[] = catalogUsers
      .filter((u) => u.spec.profile && u.spec.profile.displayName)
      .map((u) => u.spec.profile.displayName);
    console.log(
      `Checking ${JSON.stringify(catalogUsersDisplayNames)} contains users ${JSON.stringify(users)}`,
    );
    const hasAllElems = users.every((elem) =>
      catalogUsersDisplayNames.includes(elem),
    );
    return hasAllElems;
  }

  async checkGroupIsIngestedInCatalog(groups: string[]) {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const response = await api.getAllCatalogGroupsFromAPI();
    const catalogGroups: GroupEntity[] =
      response && response.items ? response.items : [];
    expect(catalogGroups.length).toBeGreaterThan(0);
    const catalogGroupsDisplayNames: string[] = catalogGroups
      .filter((u) => u.spec.profile && u.spec.profile.displayName)
      .map((u) => u.spec.profile.displayName);
    console.log(
      `Checking ${JSON.stringify(catalogGroupsDisplayNames)} contains groups ${JSON.stringify(groups)}`,
    );
    const hasAllElems = groups.every((elem) =>
      catalogGroupsDisplayNames.includes(elem),
    );
    return hasAllElems;
  }

  async checkUserIsInGroup(user: string, group: string): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const groupEntity: GroupEntity = await api.getGroupEntityFromAPI(group);
    const members = this.parseGroupMemberFromEntity(groupEntity);
    console.log(
      `Checking group ${group} (${JSON.stringify(members)}) contains groups ${user}`,
    );
    return members.includes(user);
  }

  async checkGroupIsParentOfGroup(
    parent: string,
    child: string,
  ): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const groupEntity: GroupEntity = await api.getGroupEntityFromAPI(parent);
    const children = this.parseGroupChildrenFromEntity(groupEntity);
    console.log(
      `Checking children of ${parent} (${JSON.stringify(children)}) contain group ${child}`,
    );
    return children.includes(child);
  }

  async checkGroupIsChildOfGroup(
    child: string,
    parent: string,
  ): Promise<boolean> {
    const api = new APIHelper();
    await api.UseStaticToken(this.staticToken);
    await api.UseBaseUrl(await this.computeBackstageBackendUrl());
    const groupEntity: GroupEntity = await api.getGroupEntityFromAPI(child);
    const parents = this.parseGroupParentFromEntity(groupEntity);
    console.log(
      `Checking parents of ${child} (${JSON.stringify(parents)}) contain group ${parent}`,
    );
    return parents.includes(parent);
  }
}

export default RHDHDeployment;
