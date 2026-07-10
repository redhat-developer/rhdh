/**
 * Auth instance deployer — deep module over prepare/deploy/reconcile.
 *
 * Specs and the Playwright harness call this interface; K8s/YAML/wait details
 * stay behind the seam.
 */

import { request as playwrightRequest } from "@playwright/test";

import { waitForDeploymentReadiness } from "../deployment-readiness";
import { OPERATOR_BACKEND_SECRET } from "../operator-install-profile";
import { waitForRhdhReady } from "../wait-for-rhdh-ready";

/** Minimal deployment surface the deployer needs (satisfied by RHDHDeployment). */
export type AuthDeploymentPort = {
  isRunningLocal: boolean;
  addSecretData: (key: string, value: string) => Promise<unknown>;
  updateAllConfigs: () => Promise<unknown>;
  createBackstageDeployment: (options?: { waitForReady?: boolean }) => Promise<unknown>;
  waitForDeploymentReady: () => Promise<unknown>;
  waitForSynced: () => Promise<unknown>;
  waitForConfigReconciled: () => Promise<unknown>;
  restartLocalDeployment: () => Promise<unknown>;
};

export type AuthInstanceDeployerOptions = {
  requiredEnvVars: string[];
  envSecrets?: Record<string, string>;
  extraSecrets?: Record<string, string> | (() => Record<string, string>);
  beforeSecrets?: () => Promise<void>;
  beforeDeploy?: () => Promise<void>;
  enableProvider: (deployment: AuthDeploymentPort) => Promise<void>;
};

export type AuthInstanceDeployResult = {
  url: string;
  reconcile: () => Promise<void>;
};

export type AuthInstanceDeployerHost = {
  deployment: AuthDeploymentPort;
  backstageUrl: string;
  backstageBackendUrl: string;
  expectEnvVars: (envVarNames: string[]) => void;
  loadConfigsAndProvisionNamespace: () => Promise<void>;
  addBaseUrlSecretsIfRemote: () => Promise<void>;
  addSecretsFromEnv: (entries: Record<string, string>) => Promise<void>;
  createSecret: () => Promise<void>;
};

async function waitForHttpReady(baseURL: string): Promise<void> {
  const requestContext = await playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  try {
    await waitForRhdhReady(requestContext);
  } finally {
    await requestContext.dispose();
  }
}

function readinessDeps(host: AuthInstanceDeployerHost) {
  return {
    waitForAvailable: async () => {
      await host.deployment.waitForDeploymentReady();
    },
    waitForHttpReady: async () => {
      if (host.deployment.isRunningLocal) {
        return;
      }
      await waitForHttpReady(host.backstageUrl);
    },
    waitForSynced: async () => {
      await host.deployment.waitForSynced();
    },
  };
}

/**
 * Deploy an auth-provider RHDH instance and wait Available → HTTP → synced.
 */
export async function deployAuthInstance(
  host: AuthInstanceDeployerHost,
  options: AuthInstanceDeployerOptions,
): Promise<AuthInstanceDeployResult> {
  host.expectEnvVars(options.requiredEnvVars);
  await host.loadConfigsAndProvisionNamespace();
  await options.beforeSecrets?.();
  await host.addBaseUrlSecretsIfRemote();

  if (options.envSecrets !== undefined) {
    await host.addSecretsFromEnv(options.envSecrets);
  }
  const extraSecrets =
    typeof options.extraSecrets === "function" ? options.extraSecrets() : options.extraSecrets;
  if (extraSecrets !== undefined) {
    for (const [key, value] of Object.entries(extraSecrets)) {
      await host.deployment.addSecretData(key, value);
    }
  }

  await host.deployment.addSecretData("BACKEND_SECRET", OPERATOR_BACKEND_SECRET);
  await host.createSecret();
  await options.enableProvider(host.deployment);
  await host.deployment.updateAllConfigs();
  await options.beforeDeploy?.();

  await host.deployment.createBackstageDeployment({ waitForReady: false });
  await waitForDeploymentReadiness(["available", "http", "synced"], readinessDeps(host));

  return {
    url: host.backstageUrl,
    reconcile: async () => {
      await reconcileAuthInstance(host);
    },
  };
}

/** Reconcile after in-place config changes (Available → HTTP → synced). */
export async function reconcileAuthInstance(host: AuthInstanceDeployerHost): Promise<void> {
  await host.deployment.updateAllConfigs();
  await host.deployment.restartLocalDeployment();
  await host.deployment.waitForConfigReconciled();
  await waitForDeploymentReadiness(["available", "http", "synced"], readinessDeps(host));
}
