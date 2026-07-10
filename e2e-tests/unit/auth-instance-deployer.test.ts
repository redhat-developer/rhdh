import { describe, expect, it, vi } from "vitest";

import {
  deployAuthInstance,
  type AuthDeploymentPort,
  type AuthInstanceDeployerHost,
} from "../playwright/utils/authentication-providers/auth-instance-deployer";
import { RHDH_READY_DEPLOY_TIMEOUT_MS } from "../playwright/utils/wait-for-rhdh-ready";

const healthcheckRhdhAtUrl = vi.hoisted(() =>
  vi.fn<(baseURL: string, timeoutMs?: number) => Promise<void>>().mockResolvedValue(),
);

vi.mock("../playwright/utils/wait-for-rhdh-ready", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../playwright/utils/wait-for-rhdh-ready")>();
  return {
    ...actual,
    healthcheckRhdhAtUrl,
  };
});

function createHost(isRunningLocal: boolean): AuthInstanceDeployerHost & { calls: string[] } {
  const calls: string[] = [];
  const deployment: AuthDeploymentPort = {
    isRunningLocal,
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
    waitForDeploymentCreated: () => {
      calls.push("waitForDeploymentCreated");
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
  it("does not put BACKEND_SECRET in rhdh-secrets (CR env owns it)", async () => {
    const host = createHost(true);
    await deployAuthInstance(host, {
      requiredEnvVars: ["FOO"],
      enableProvider: () => {
        host.calls.push("enableProvider");
        return Promise.resolve();
      },
    });

    expect(host.calls).not.toContain("secret:BACKEND_SECRET");
  });

  it("stages created → synced locally without HTTP", async () => {
    const host = createHost(true);
    await deployAuthInstance(host, {
      requiredEnvVars: ["FOO"],
      enableProvider: () => {
        host.calls.push("enableProvider");
        return Promise.resolve();
      },
    });

    expect(host.calls).toEqual([
      "expectEnvVars",
      "loadConfigs",
      "addBaseUrlSecrets",
      "createSecret",
      "enableProvider",
      "updateAllConfigs",
      "createBackstageDeployment:false",
      "waitForDeploymentCreated",
      "waitForSynced",
    ]);
    expect(healthcheckRhdhAtUrl).not.toHaveBeenCalled();
  });

  it("stages created → HTTP → synced on the remote CI path", async () => {
    const host = createHost(false);
    healthcheckRhdhAtUrl.mockClear();
    healthcheckRhdhAtUrl.mockImplementation(() => {
      host.calls.push("http");
      return Promise.resolve();
    });
    await deployAuthInstance(host, {
      requiredEnvVars: ["FOO"],
      enableProvider: () => {
        host.calls.push("enableProvider");
        return Promise.resolve();
      },
    });

    expect(host.calls).toEqual([
      "expectEnvVars",
      "loadConfigs",
      "addBaseUrlSecrets",
      "createSecret",
      "enableProvider",
      "updateAllConfigs",
      "createBackstageDeployment:false",
      "waitForDeploymentCreated",
      "http",
      "waitForSynced",
    ]);
    expect(healthcheckRhdhAtUrl).toHaveBeenCalledExactlyOnceWith(
      "https://rhdh.example.test",
      RHDH_READY_DEPLOY_TIMEOUT_MS,
    );
  });
});
