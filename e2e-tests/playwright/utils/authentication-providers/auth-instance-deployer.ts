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
  setAppConfigProperty: (path: string, value: unknown) => unknown;
  updateAllConfigs: () => Promise<unknown>;
  createBackstageDeployment: (options?: { waitForReady?: boolean }) => Promise<unknown>;
  waitForDeploymentCreated: () => Promise<unknown>;
  waitForSynced: () => Promise<unknown>;
  /** Persist → force restart → prove marker in mounted config (remote). */
  waitUntilAuthConfigLive: (configMarker: string) => Promise<unknown>;
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
};

export type ReconcileAuthInstanceOptions = {
  /** When true, also wait for catalog sync after HTTP. Default false (auth-only). */
  waitForCatalogSync?: boolean;
};

export type AuthNamespaceProvision = "fresh" | "reused";

export type AuthInstanceDeployerHost = {
  deployment: AuthDeploymentPort;
  backstageUrl: string;
  backstageBackendUrl: string;
  expectEnvVars: (envVarNames: string[]) => void;
  /**
   * Load file configs and either wipe+provision a new namespace (`fresh`) or
   * keep a healthy existing one (`reused`) so worker restarts after flakes do
   * not pay full CR recreate cost.
   */
  loadConfigsAndProvisionNamespace: () => Promise<AuthNamespaceProvision>;
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

function newAuthConfigMarker(): string {
  return `e2e-auth-config-${String(Date.now())}`;
}

/**
 * Deploy an auth-provider RHDH instance and wait created → HTTP → synced.
 *
 * When the namespace is reused (healthy leftover from a prior worker), still
 * re-apply secrets/CR/provider baseline, then reconcile with catalog sync
 * instead of deleting the namespace — preserves IdP redirect registrations
 * while resetting resolver state.
 *
 * BACKEND_SECRET comes only from the CR extraEnvs (OperatorInstallProfile) —
 * do not also put it in rhdh-secrets or the operator emits a duplicate env.
 */
export async function deployAuthInstance(
  host: AuthInstanceDeployerHost,
  options: AuthInstanceDeployerOptions,
): Promise<AuthInstanceDeployResult> {
  host.expectEnvVars(options.requiredEnvVars);
  const provision = await host.loadConfigsAndProvisionNamespace();

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

  if (provision === "reused") {
    // Namespace/CR already existed (worker retry). Re-apply baseline above, then
    // force process restart + catalog sync so leftover resolver state cannot leak.
    await reconcileAuthInstance(host, { waitForCatalogSync: true });
    return { url: host.backstageUrl };
  }

  await waitForDeploymentReadiness(["created", "http", "synced"], readinessDeps(host));
  return { url: host.backstageUrl };
}

/**
 * Reconcile after in-place config changes.
 *
 * Auth settings are process-start only: stamp a title marker, persist ConfigMaps,
 * force a workload restart, prove the marker is on the mounted config, then HTTP.
 * Catalog sync is opt-in — most auth-only mutations do not need it.
 */
export async function reconcileAuthInstance(
  host: AuthInstanceDeployerHost,
  options: ReconcileAuthInstanceOptions = {},
): Promise<void> {
  const marker = newAuthConfigMarker();
  host.deployment.setAppConfigProperty("app.title", marker);
  await host.deployment.updateAllConfigs();
  await host.deployment.restartLocalDeployment();
  await host.deployment.waitUntilAuthConfigLive(marker);
  await waitForDeploymentReadiness(["http"], readinessDeps(host));
  if (options.waitForCatalogSync === true) {
    await waitForDeploymentReadiness(["synced"], readinessDeps(host));
  }
}
