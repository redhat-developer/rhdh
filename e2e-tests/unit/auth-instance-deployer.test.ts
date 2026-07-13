import { describe, expect, it, vi } from "vitest";

import {
  deployAuthInstance,
  reconcileAuthInstance,
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
    setAppConfigProperty: (path: string, value: unknown) => {
      calls.push(`setAppConfigProperty:${path}:${String(value)}`);
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
    waitUntilAuthConfigLive: (marker: string) => {
      calls.push(`waitUntilAuthConfigLive:${marker}`);
      return Promise.resolve();
    },
    restartLocalDeployment: () => {
      calls.push("restartLocalDeployment");
      return Promise.resolve();
    },
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

  it("returns only the instance URL (no unused reconcile handle)", async () => {
    const host = createHost(true);
    const result = await deployAuthInstance(host, {
      requiredEnvVars: ["FOO"],
      enableProvider: () => Promise.resolve(),
    });

    expect(result).toEqual({ url: "https://rhdh.example.test" });
    expect(result).not.toHaveProperty("reconcile");
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

describe("reconcileAuthInstance", () => {
  it("stamps a title marker, restarts, proves live, then HTTP only by default", async () => {
    const host = createHost(false);
    healthcheckRhdhAtUrl.mockClear();
    healthcheckRhdhAtUrl.mockImplementation(() => {
      host.calls.push("http");
      return Promise.resolve();
    });

    await reconcileAuthInstance(host);

    expect(host.calls[0]).toMatch(/^setAppConfigProperty:app\.title:e2e-auth-config-/u);
    expect(host.calls.slice(1, 4)).toEqual([
      "updateAllConfigs",
      "restartLocalDeployment",
      expect.stringMatching(/^waitUntilAuthConfigLive:e2e-auth-config-/u),
    ]);
    expect(host.calls).toContain("http");
    expect(host.calls).not.toContain("waitForSynced");
    expect(host.calls).not.toContain("waitForDeploymentCreated");
  });

  it("opts into catalog sync when waitForCatalogSync is true", async () => {
    const host = createHost(false);
    healthcheckRhdhAtUrl.mockClear();
    healthcheckRhdhAtUrl.mockImplementation(() => {
      host.calls.push("http");
      return Promise.resolve();
    });

    await reconcileAuthInstance(host, { waitForCatalogSync: true });

    expect(host.calls).toContain("http");
    expect(host.calls).toContain("waitForSynced");
  });

  it("skips remote HTTP on local path but still proves config live", async () => {
    const host = createHost(true);
    healthcheckRhdhAtUrl.mockClear();

    await reconcileAuthInstance(host);

    expect(host.calls[0]).toMatch(/^setAppConfigProperty:app\.title:e2e-auth-config-/u);
    expect(host.calls).toContain("restartLocalDeployment");
    expect(host.calls.some((c) => c.startsWith("waitUntilAuthConfigLive:"))).toBe(true);
    expect(host.calls).not.toContain("waitForSynced");
    expect(healthcheckRhdhAtUrl).not.toHaveBeenCalled();
  });
});
