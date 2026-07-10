import { describe, expect, it, vi } from "vitest";

import {
  deployAuthInstance,
  type AuthDeploymentPort,
  type AuthInstanceDeployerHost,
} from "../playwright/utils/authentication-providers/auth-instance-deployer";

function createHost(): AuthInstanceDeployerHost & { calls: string[] } {
  const calls: string[] = [];
  const deployment: AuthDeploymentPort = {
    isRunningLocal: true,
    addSecretData: (key: string) => {
      calls.push(`secret:${key}`);
      return Promise.resolve();
    },
    updateAllConfigs: () => {
      calls.push("updateAllConfigs");
      return Promise.resolve();
    },
    createBackstageDeployment: (options?: { waitForReady?: boolean }) => {
      calls.push(`createBackstageDeployment:${String(options?.waitForReady)}`);
      return Promise.resolve();
    },
    waitForDeploymentReady: () => {
      calls.push("waitForDeploymentReady");
      return Promise.resolve();
    },
    waitForSynced: () => {
      calls.push("waitForSynced");
      return Promise.resolve();
    },
    waitForConfigReconciled: () => Promise.resolve(),
    restartLocalDeployment: () => Promise.resolve(),
  };

  return {
    calls,
    deployment,
    backstageUrl: "https://rhdh.example.test",
    backstageBackendUrl: "https://rhdh.example.test",
    expectEnvVars: () => {
      calls.push("expectEnvVars");
    },
    loadConfigsAndProvisionNamespace: () => {
      calls.push("loadConfigs");
      return Promise.resolve();
    },
    addBaseUrlSecretsIfRemote: () => {
      calls.push("addBaseUrlSecrets");
      return Promise.resolve();
    },
    addSecretsFromEnv: () => {
      calls.push("addSecretsFromEnv");
      return Promise.resolve();
    },
    createSecret: () => {
      calls.push("createSecret");
      return Promise.resolve();
    },
  };
}

describe("deployAuthInstance", () => {
  it("applies BACKEND_SECRET, deploys without nested wait, then stages readiness", async () => {
    const host = createHost();
    const enableProvider = vi
      .fn<(deployment: AuthDeploymentPort) => Promise<void>>()
      .mockImplementation(() => {
        host.calls.push("enableProvider");
        return Promise.resolve();
      });

    const result = await deployAuthInstance(host, {
      requiredEnvVars: ["FOO"],
      enableProvider,
    });

    expect(result.url).toBe("https://rhdh.example.test");
    expect(host.calls).toEqual([
      "expectEnvVars",
      "loadConfigs",
      "addBaseUrlSecrets",
      "secret:BACKEND_SECRET",
      "createSecret",
      "enableProvider",
      "updateAllConfigs",
      "createBackstageDeployment:false",
      "waitForDeploymentReady",
      "waitForSynced",
    ]);
    expect(typeof result.reconcile).toBe("function");
  });
});
