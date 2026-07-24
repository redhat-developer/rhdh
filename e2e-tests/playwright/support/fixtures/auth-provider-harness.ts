import { expect } from "@playwright/test";

import {
  deployAuthInstance,
  reconcileAuthInstance,
  type AuthNamespaceProvision,
  type ReconcileAuthInstanceOptions,
} from "../../utils/authentication-providers/auth-instance-deployer";
import RHDHDeployment from "../../utils/authentication-providers/rhdh-deployment";
import { healthcheckRhdhAtUrl } from "../../utils/wait-for-rhdh-ready";
import type { LoginOutcome } from "../auth/app-shell";

const DEFAULT_CONFIG_MAPS = {
  appConfigMap: "app-config-rhdh",
  rbacConfigMap: "rbac-policy",
  dynamicPluginsConfigMap: "dynamic-plugins",
  secretName: "rhdh-secrets",
} as const;

/** Short probe — only decides wipe vs reuse, not deploy readiness. */
const REUSE_HEALTHCHECK_TIMEOUT_MS = 20_000;

type AuthLoginCase = {
  configure?: () => Promise<void>;
  login: () => Promise<LoginOutcome>;
  assert: () => Promise<void>;
  cleanup?: () => Promise<void>;
  expectedResult?: LoginOutcome;
};

/** Deploy/config glue for auth-provider E2E specs. For Playwright wiring use createAuthProviderHarness. */
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

  /**
   * Prefer reusing a healthy remote instance after Playwright worker restarts
   * (flake retries). Wipe only when forced, local, or healthcheck fails.
   */
  async loadConfigsAndProvisionNamespace(): Promise<AuthNamespaceProvision> {
    await this.deployment.loadAllConfigs();
    if (await this.canReuseHealthyRemoteInstance()) {
      await this.deployment.generateStaticToken();
      console.log(
        "[INFO] Reusing healthy auth namespace — skip wipe (set FORCE_AUTH_REDEPLOY=1 to force)",
      );
      return "reused";
    }
    await this.deployment.deleteNamespaceIfExists();
    await (await this.deployment.createNamespace()).waitForNamespaceActive();
    await this.deployment.createAllConfigs();
    await this.deployment.generateStaticToken();
    return "fresh";
  }

  private async canReuseHealthyRemoteInstance(): Promise<boolean> {
    if (this.deployment.isRunningLocal) {
      return false;
    }
    if (process.env.FORCE_AUTH_REDEPLOY === "1") {
      return false;
    }
    try {
      await healthcheckRhdhAtUrl(this.backstageUrl, REUSE_HEALTHCHECK_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
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

  async prepareProvider(options: {
    requiredEnvVars: string[];
    envSecrets?: Record<string, string>;
    extraSecrets?: Record<string, string> | (() => Record<string, string>);
    beforeSecrets?: () => Promise<void>;
    beforeDeploy?: () => Promise<void>;
    enableProvider: (deployment: RHDHDeployment) => Promise<void>;
  }): Promise<void> {
    await deployAuthInstance(this, {
      ...options,
      enableProvider: async () => {
        await options.enableProvider(this.deployment);
      },
    });
  }

  async reconcileAfterConfigChange(options?: ReconcileAuthInstanceOptions): Promise<void> {
    await reconcileAuthInstance(this, options);
  }

  async runLoginCase(options: AuthLoginCase): Promise<void> {
    try {
      if (options.configure !== undefined) {
        await options.configure();
      }
      const result = await options.login();
      expect(result).toBe(options.expectedResult ?? "authenticated");
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
