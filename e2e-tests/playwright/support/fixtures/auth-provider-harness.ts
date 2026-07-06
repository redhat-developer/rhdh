import { expect } from "@playwright/test";

import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";

const DEFAULT_CONFIG_MAPS = {
  appConfigMap: "app-config-rhdh",
  rbacConfigMap: "rbac-policy",
  dynamicPluginsConfigMap: "dynamic-plugins",
  secretName: "rhdh-secrets",
} as const;

type PrepareAuthProviderOptions = {
  requiredEnvVars: string[];
  envSecrets?: Record<string, string>;
  extraSecrets?: Record<string, string> | (() => Record<string, string>);
  beforeSecrets?: () => Promise<void>;
  beforeDeploy?: () => Promise<void>;
  enableProvider: (deployment: RHDHDeployment) => Promise<void>;
};

type AuthLoginCase = {
  configure?: () => Promise<void>;
  login: () => Promise<string>;
  assert: () => Promise<void>;
  cleanup?: () => Promise<void>;
  expectedResult?: string;
};

/** Shared K8s + RHDH deployment orchestration for auth-provider E2E specs. */
export class AuthProviderHarness {
  readonly deployment: RHDHDeployment;
  readonly backstageUrl: string;
  readonly backstageBackendUrl: string;

  private constructor(
    deployment: RHDHDeployment,
    backstageUrl: string,
    backstageBackendUrl: string,
  ) {
    this.deployment = deployment;
    this.backstageUrl = backstageUrl;
    this.backstageBackendUrl = backstageBackendUrl;
  }

  static create(namespace: string, instanceName = "rhdh"): AuthProviderHarness {
    const deployment = new RHDHDeployment(
      namespace,
      DEFAULT_CONFIG_MAPS.appConfigMap,
      DEFAULT_CONFIG_MAPS.rbacConfigMap,
      DEFAULT_CONFIG_MAPS.dynamicPluginsConfigMap,
      DEFAULT_CONFIG_MAPS.secretName,
    );
    deployment.instanceName = instanceName;
    const backstageUrl = deployment.getBackstageUrl();
    const backstageBackendUrl = deployment.getBackstageBackendUrl();
    console.log(`Backstage BaseURL is: ${backstageUrl}`);
    return new AuthProviderHarness(deployment, backstageUrl, backstageBackendUrl);
  }

  expectEnvVars(envVarNames: string[]): void {
    for (const name of envVarNames) {
      expect(process.env[name]).toBeDefined();
    }
  }

  async loadConfigsAndProvisionNamespace(): Promise<void> {
    await this.deployment.loadAllConfigs();
    await this.deployment.deleteNamespaceIfExists();
    await (await this.deployment.createNamespace()).waitForNamespaceActive();
    await this.deployment.createAllConfigs();
    await this.deployment.generateStaticToken();
  }

  async addBaseUrlSecretsIfRemote(): Promise<void> {
    if (
      process.env.ISRUNNINGLOCAL === undefined ||
      process.env.ISRUNNINGLOCAL === "" ||
      process.env.ISRUNNINGLOCAL === "false"
    ) {
      await this.deployment.addSecretData("BASE_URL", this.backstageUrl);
      await this.deployment.addSecretData("BASE_BACKEND_URL", this.backstageBackendUrl);
    }
  }

  async addSecretsFromEnv(entries: Record<string, string>): Promise<void> {
    for (const [secretKey, envVar] of Object.entries(entries)) {
      await this.deployment.addSecretData(secretKey, process.env[envVar]!);
    }
  }

  async createSecret(): Promise<void> {
    await this.deployment.createSecret();
  }

  async deployAndWait(): Promise<void> {
    await this.deployment.createBackstageDeployment();
    await this.deployment.waitForDeploymentReady();
    await this.deployment.waitForSynced();
  }

  async prepareProvider(options: PrepareAuthProviderOptions): Promise<void> {
    this.expectEnvVars(options.requiredEnvVars);
    await this.loadConfigsAndProvisionNamespace();
    await options.beforeSecrets?.();
    await this.addBaseUrlSecretsIfRemote();

    if (options.envSecrets !== undefined) {
      await this.addSecretsFromEnv(options.envSecrets);
    }
    const extraSecrets =
      typeof options.extraSecrets === "function" ? options.extraSecrets() : options.extraSecrets;
    if (extraSecrets !== undefined) {
      for (const [key, value] of Object.entries(extraSecrets)) {
        await this.deployment.addSecretData(key, value);
      }
    }

    await this.createSecret();
    await options.enableProvider(this.deployment);
    await this.deployment.updateAllConfigs();
    await options.beforeDeploy?.();
    await this.deployAndWait();
  }

  async reconcileAfterConfigChange(): Promise<void> {
    await this.deployment.updateAllConfigs();
    await this.deployment.restartLocalDeployment();
    await this.deployment.waitForConfigReconciled();
    await this.deployment.waitForDeploymentReady();
    await this.deployment.waitForSynced();
  }

  async runLoginCase(options: AuthLoginCase): Promise<void> {
    try {
      if (options.configure !== undefined) {
        await options.configure();
      }
      const result = await options.login();
      expect(result).toBe(options.expectedResult ?? "Login successful");
      await options.assert();
    } finally {
      await options.cleanup?.();
    }
  }

  async cleanup(): Promise<void> {
    console.log("[TEST] Starting cleanup...");
    await this.deployment.killRunningProcess();
    console.log("[TEST] Cleanup completed");
  }
}
