/**
 * Auth instance deployer — deep module over prepare/deploy/reconcile.
 *
 * Specs and the Playwright harness call this interface; K8s/YAML/wait details
 * stay behind the seam.
 */

import { waitForDeploymentReadiness } from "../deployment-readiness";
import { RHDH_READY_DEPLOY_TIMEOUT_MS, healthcheckRhdhAtUrl } from "../wait-for-rhdh-ready";

/** Minimal deployment surface the deployer needs (satisfied by RHDHDeployment). */
export type AuthDeploymentPort = {
  isRunningLocal: boolean;
  addSecretData: (key: string, value: string) => Promise<unknown>;
  updateAllConfigs: () => Promise<unknown>;
  createBackstageDeployment: (options?: { waitForReady?: boolean }) => Promise<unknown>;
  waitForDeploymentCreated: () => Promise<unknown>;
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

function readinessDeps(host: AuthInstanceDeployerHost) {
  return {
    waitForCreated: async () => {
      await host.deployment.waitForDeploymentCreated();
    },
    waitForHttpReady: async () => {
      if (host.deployment.isRunningLocal) {
        return;
      }
      await healthcheckRhdhAtUrl(host.backstageUrl, RHDH_READY_DEPLOY_TIMEOUT_MS);
    },
    waitForSynced: async () => {
      await host.deployment.waitForSynced();
    },
  };
}

/**
 * Deploy an auth-provider RHDH instance and wait created → HTTP → synced.
 *
 * BACKEND_SECRET comes only from the CR extraEnvs (OperatorInstallProfile) —
 * do not also put it in rhdh-secrets or the operator emits a duplicate env.
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

  await host.createSecret();
  await options.enableProvider(host.deployment);
  await host.deployment.updateAllConfigs();
  await options.beforeDeploy?.();

  await host.deployment.createBackstageDeployment({ waitForReady: false });
  await waitForDeploymentReadiness(["created", "http", "synced"], readinessDeps(host));

  return {
    url: host.backstageUrl,
    reconcile: async () => {
      await reconcileAuthInstance(host);
    },
  };
}

/** Reconcile after in-place config changes (created → HTTP → synced). */
export async function reconcileAuthInstance(host: AuthInstanceDeployerHost): Promise<void> {
  await host.deployment.updateAllConfigs();
  await host.deployment.restartLocalDeployment();
  await host.deployment.waitForConfigReconciled();
  await waitForDeploymentReadiness(["created", "http", "synced"], readinessDeps(host));
}
