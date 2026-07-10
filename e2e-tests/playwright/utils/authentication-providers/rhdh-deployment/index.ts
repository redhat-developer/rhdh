import { ChildProcess } from "child_process";

import * as k8s from "@kubernetes/client-node";
import { expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";

import {
  enableGithubLoginWithIngestion,
  enableGitlabLoginWithIngestion,
  enableLDAPLoginWithIngestion,
  enableMicrosoftLoginWithIngestion,
  enableOIDCLoginWithIngestion,
  enablePingFederateOIDCLogin,
  printDynamicPluginsConfig,
  setDynamicPluginEnabled as setDynamicPluginEnabledImpl,
  setGithubResolver as setGithubResolverImpl,
  setGitlabResolver as setGitlabResolverImpl,
  setMicrosoftResolver as setMicrosoftResolverImpl,
  setOIDCResolver as setOIDCResolverImpl,
} from "./auth";
import {
  checkGroupIsChildOfGroup,
  checkGroupIsIngestedInCatalog,
  checkGroupIsParentOfGroup,
  checkUserHasAnnotation,
  checkUserIsIngestedInCatalog,
  checkUserIsInGroup,
  parseGroupChildrenFromEntity,
  parseGroupMemberFromEntity,
  parseGroupParentFromEntity,
} from "./catalog";
import {
  applyCustomResource,
  computeBackstageBackendUrl as computeBackstageBackendUrlImpl,
  computeBackstageUrl as computeBackstageUrlImpl,
  createAppConfig as createAppConfigImpl,
  createBackstageDeployment as createBackstageDeploymentImpl,
  createDynamicPluginsConfig as createDynamicPluginsConfigImpl,
  createNamespace as createNamespaceImpl,
  createRbacConfig as createRbacConfigImpl,
  createSecret as createSecretImpl,
  deleteConfigMap as deleteConfigMapImpl,
  deleteSecret as deleteSecretImpl,
  killRunningProcess as killRunningProcessImpl,
  loadBackstageCR as loadBackstageCRImpl,
  loadBaseConfig as loadBaseConfigImpl,
  loadDynamicPluginsConfig as loadDynamicPluginsConfigImpl,
  loadRbacConfig as loadRbacConfigImpl,
  readYamlToJson,
  updateAppConfig as updateAppConfigImpl,
  updateDynamicPluginsConfig as updateDynamicPluginsConfigImpl,
  updateRbacConfig as updateRbacConfigImpl,
  updateSecret as updateSecretImpl,
} from "./k8s";
import {
  followLocalLogs as followLocalLogsImpl,
  followLogs as followLogsImpl,
  followPodLogs as followPodLogsImpl,
  waitForSynced as waitForSyncedImpl,
} from "./logs";
import {
  BackstageCr,
  DynamicPluginsConfig,
  isRecord,
  isRunningLocalMode,
  RHDHDeploymentState,
  shouldUseKubernetesClient,
  YamlConfig,
} from "./types";
import {
  deleteNamespaceIfExists as deleteNamespaceIfExistsImpl,
  getDeploymentGeneration as getDeploymentGenerationImpl,
  tryGetDeploymentGeneration as tryGetDeploymentGenerationImpl,
  waitForConfigReconciled as waitForConfigReconciledImpl,
  waitForDeploymentReady as waitForDeploymentReadyImpl,
  waitForNamespaceActive as waitForNamespaceActiveImpl,
} from "./wait";

class RHDHDeployment implements RHDHDeploymentState {
  instanceName = "";
  kc!: k8s.KubeConfig;
  k8sApi!: k8s.CoreV1Api;
  appsV1Api!: k8s.AppsV1Api;
  namespace: string;
  appConfigMap: string;
  rbacConfigMap: string;
  dynamicPluginsConfigMap: string;
  secretName: string;
  appConfig: YamlConfig = {};
  dynamicPluginsConfig: DynamicPluginsConfig = { plugins: [] };
  rbacConfig = "";
  secretData: Record<string, string> = {};
  isRunningLocal = false;
  runningProcess: ChildProcess | null = null;
  staticToken = "";
  cr: BackstageCr = {
    apiVersion: "",
    kind: "",
    metadata: { name: "" },
    spec: {},
  };
  configReconcileBaselineGeneration: number | undefined;

  constructor(
    namespace: string,
    appConfigMap: string,
    rbacConfigMap: string,
    dynamicPluginsConfigMap: string,
    secretName: string,
  ) {
    if (shouldUseKubernetesClient()) {
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
    this.isRunningLocal = isRunningLocalMode();
  }

  addSecretData(key: string, value: string): Promise<RHDHDeployment> {
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
    return Promise.resolve(this);
  }

  removeSecretData(key: string): Promise<RHDHDeployment> {
    if (key.length === 0) {
      throw new Error("Key cannot be empty");
    }
    if (key in this.secretData) {
      delete this.secretData[key];
    }
    return Promise.resolve(this);
  }

  async createNamespace(): Promise<RHDHDeployment> {
    await createNamespaceImpl(this);
    return this;
  }

  async deleteNamespaceIfExists(timeoutMs = 60000): Promise<RHDHDeployment> {
    await deleteNamespaceIfExistsImpl(this, timeoutMs);
    return this;
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
    await loadBaseConfigImpl(this);
    return this;
  }

  async applyCustomResource(resource: BackstageCr): Promise<RHDHDeployment> {
    await applyCustomResource(this, resource);
    return this;
  }

  readYamlToJson(filePath: string): Promise<unknown> {
    return readYamlToJson(filePath);
  }

  async createAppConfig(): Promise<RHDHDeployment> {
    await createAppConfigImpl(this);
    return this;
  }

  async updateAppConfig(): Promise<RHDHDeployment> {
    await updateAppConfigImpl(this);
    return this;
  }

  async deleteConfigMap(): Promise<RHDHDeployment> {
    await deleteConfigMapImpl(this);
    return this;
  }

  async createSecret(): Promise<RHDHDeployment> {
    await createSecretImpl(this);
    return this;
  }

  async updateSecret(): Promise<RHDHDeployment> {
    await updateSecretImpl(this);
    return this;
  }

  async deleteSecret(): Promise<RHDHDeployment> {
    await deleteSecretImpl(this);
    return this;
  }

  getDeploymentGeneration(): Promise<number> {
    return getDeploymentGenerationImpl(this);
  }

  async waitForConfigReconciled(timeoutMs = 60000): Promise<RHDHDeployment> {
    await waitForConfigReconciledImpl(this, timeoutMs);
    return this;
  }

  async waitForDeploymentReady(timeoutMs = 600000): Promise<RHDHDeployment> {
    await waitForDeploymentReadyImpl(this, timeoutMs);
    return this;
  }

  async waitForNamespaceActive(timeoutMs = 30000): Promise<RHDHDeployment> {
    await waitForNamespaceActiveImpl(this, timeoutMs);
    return this;
  }

  async loadRbacConfig(): Promise<RHDHDeployment> {
    await loadRbacConfigImpl(this);
    return this;
  }

  async createRbacConfig(): Promise<RHDHDeployment> {
    await createRbacConfigImpl(this);
    return this;
  }

  async updateRbacConfig(): Promise<RHDHDeployment> {
    await updateRbacConfigImpl(this);
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
    await loadDynamicPluginsConfigImpl(this);
    return this;
  }

  async createDynamicPluginsConfig(): Promise<RHDHDeployment> {
    await createDynamicPluginsConfigImpl(
      this,
      (path, value) => {
        this.setAppConfigProperty(path, value);
      },
      updateAppConfigImpl,
    );
    return this;
  }

  async updateDynamicPluginsConfig(): Promise<RHDHDeployment> {
    await updateDynamicPluginsConfigImpl(this);
    return this;
  }

  loadBackstageCR(): Promise<BackstageCr> {
    return loadBackstageCRImpl(this);
  }

  async createBackstageDeployment(): Promise<RHDHDeployment> {
    await createBackstageDeploymentImpl(this);
    return this;
  }

  async killRunningProcess(): Promise<void> {
    await killRunningProcessImpl(this, () => this.computeBackstageUrl());
  }

  followPodLogs(
    searchString: RegExp,
    podName?: string,
    podLabels?: Record<string, string>,
    timeoutMs = 300000,
  ): Promise<boolean> {
    return followPodLogsImpl(this, searchString, podName, podLabels, timeoutMs);
  }

  followLocalLogs(searchString: RegExp, timeoutMs = 30000): Promise<boolean> {
    return followLocalLogsImpl(this, searchString, timeoutMs);
  }

  followLogs(searchString: RegExp, timeoutMs = 300000): Promise<boolean> {
    return followLogsImpl(this, searchString, timeoutMs);
  }

  getBackstageUrl(): string {
    return computeBackstageUrlImpl(this);
  }

  computeBackstageUrl(): Promise<string> {
    return Promise.resolve(this.getBackstageUrl());
  }

  getBackstageBackendUrl(): string {
    return computeBackstageBackendUrlImpl(this);
  }

  computeBackstageBackendUrl(): Promise<string> {
    return Promise.resolve(this.getBackstageBackendUrl());
  }

  async loadAllConfigs(): Promise<RHDHDeployment> {
    if (this.appConfigMap !== "") {
      await this.loadBaseConfig();
    }
    if (this.dynamicPluginsConfigMap !== "") {
      await this.loadDynamicPluginsConfig();
    }
    if (this.rbacConfigMap !== "") {
      await this.loadRbacConfig();
    }
    await this.loadBackstageCR();
    return this;
  }

  async checkBaseUrlReachable(): Promise<boolean> {
    const baseUrl = await this.computeBackstageUrl();
    try {
      const response = await fetch(baseUrl, { method: "HEAD" });
      return response.status === 200;
    } catch (error: unknown) {
      const { getErrorMessage } = await import("../../errors");
      console.log(`Error: ${getErrorMessage(error)}`);
      return false;
    }
  }

  async expectBaseUrlReachable(): Promise<void> {
    const isReachable = await this.checkBaseUrlReachable();
    expect(isReachable).toBe(true);
  }

  setDynamicPluginEnabled(pluginName: string, enabled: boolean): RHDHDeployment {
    setDynamicPluginEnabledImpl(this, pluginName, enabled);
    return this;
  }

  printDynamicPluginsConfig(): void {
    printDynamicPluginsConfig(this);
  }

  enableOIDCLoginWithIngestion(): Promise<RHDHDeployment> {
    enableOIDCLoginWithIngestion(this);
    return Promise.resolve(this);
  }

  enablePingFederateOIDCLogin(): Promise<RHDHDeployment> {
    enablePingFederateOIDCLogin(this);
    return Promise.resolve(this);
  }

  enableLDAPLoginWithIngestion(): Promise<RHDHDeployment> {
    enableLDAPLoginWithIngestion(this);
    return Promise.resolve(this);
  }

  enableMicrosoftLoginWithIngestion(): Promise<RHDHDeployment> {
    enableMicrosoftLoginWithIngestion(this);
    return Promise.resolve(this);
  }

  enableGithubLoginWithIngestion(): Promise<RHDHDeployment> {
    enableGithubLoginWithIngestion(this, this.isRunningLocal);
    return Promise.resolve(this);
  }

  async createAllConfigs(): Promise<RHDHDeployment> {
    await this.createAppConfig();
    await this.createDynamicPluginsConfig();
    await this.createRbacConfig();
    return this;
  }

  async updateAllConfigs(): Promise<RHDHDeployment> {
    if (!this.isRunningLocal) {
      // First-time prepareProvider updates configs before createBackstageDeployment,
      // so the deployment may not exist yet. Baseline is only needed for later
      // reconcileAfterConfigChange waits.
      this.configReconcileBaselineGeneration = await tryGetDeploymentGenerationImpl(this);
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

  generateStaticToken(): Promise<RHDHDeployment> {
    const token = uuidv4();
    this.staticToken = token;
    return this.addSecretData("STATIC_TOKEN", token);
  }

  getCurrentStaticToken(): string {
    return this.staticToken;
  }

  setOIDCResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog = false,
  ): Promise<RHDHDeployment> {
    setOIDCResolverImpl(this, resolver, dangerouslyAllowSignInWithoutUserInCatalog);
    return Promise.resolve(this);
  }

  setMicrosoftResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog = false,
  ): Promise<RHDHDeployment> {
    setMicrosoftResolverImpl(this, resolver, dangerouslyAllowSignInWithoutUserInCatalog);
    return Promise.resolve(this);
  }

  setGithubResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog = false,
  ): Promise<RHDHDeployment> {
    setGithubResolverImpl(this, resolver, dangerouslyAllowSignInWithoutUserInCatalog);
    return Promise.resolve(this);
  }

  enableGitlabLoginWithIngestion(): Promise<RHDHDeployment> {
    enableGitlabLoginWithIngestion(this);
    return Promise.resolve(this);
  }

  setGitlabResolver(
    resolver: string,
    dangerouslyAllowSignInWithoutUserInCatalog = false,
  ): Promise<RHDHDeployment> {
    setGitlabResolverImpl(this, resolver, dangerouslyAllowSignInWithoutUserInCatalog);
    return Promise.resolve(this);
  }

  async waitForSynced(): Promise<RHDHDeployment> {
    await waitForSyncedImpl(this);
    return this;
  }

  parseGroupMemberFromEntity = parseGroupMemberFromEntity;
  parseGroupChildrenFromEntity = parseGroupChildrenFromEntity;
  parseGroupParentFromEntity = parseGroupParentFromEntity;

  checkUserIsIngestedInCatalog(users: string[]): Promise<boolean> {
    return checkUserIsIngestedInCatalog(this, users, () => this.computeBackstageBackendUrl());
  }

  checkGroupIsIngestedInCatalog(groups: string[]): Promise<boolean> {
    return checkGroupIsIngestedInCatalog(this, groups, () => this.computeBackstageBackendUrl());
  }

  checkUserIsInGroup(user: string, group: string): Promise<boolean> {
    return checkUserIsInGroup(this, user, group, () => this.computeBackstageBackendUrl());
  }

  checkGroupIsParentOfGroup(parent: string, child: string): Promise<boolean> {
    return checkGroupIsParentOfGroup(this, parent, child, () => this.computeBackstageBackendUrl());
  }

  checkGroupIsChildOfGroup(child: string, parent: string): Promise<boolean> {
    return checkGroupIsChildOfGroup(this, child, parent, () => this.computeBackstageBackendUrl());
  }

  checkUserHasAnnotation(
    user: string,
    annotationKey: string,
    expectedValue: string,
  ): Promise<boolean> {
    return checkUserHasAnnotation(this, user, annotationKey, expectedValue, () =>
      this.computeBackstageBackendUrl(),
    );
  }
}

export default RHDHDeployment;
