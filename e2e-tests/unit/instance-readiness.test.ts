import { describe, expect, it, vi } from "vitest";

import { classifyBaseUrlMode, ensurePlaywrightReady } from "../playwright/utils/instance-readiness";

describe("classifyBaseUrlMode", () => {
  it("returns unset when BASE_URL is missing", () => {
    expect(classifyBaseUrlMode({})).toBe("unset");
  });

  it("returns unset when BASE_URL is blank", () => {
    expect(classifyBaseUrlMode({ BASE_URL: "   " })).toBe("unset");
  });

  it("returns router-stub when BASE_URL points only at the cluster router", () => {
    expect(
      classifyBaseUrlMode({
        BASE_URL: "https://apps.cluster.example.com",
        K8S_CLUSTER_ROUTER_BASE: "apps.cluster.example.com",
      }),
    ).toBe("router-stub");
  });

  it("returns router-stub for apps.* host without K8S_CLUSTER_ROUTER_BASE", () => {
    expect(
      classifyBaseUrlMode({
        BASE_URL: "https://apps.cluster.example.com",
      }),
    ).toBe("router-stub");
  });

  it("returns instance-url when BASE_URL points at an RHDH route", () => {
    expect(
      classifyBaseUrlMode({
        BASE_URL: "https://showcase-developer-hub-showcase-runtime.apps.cluster.example.com",
      }),
    ).toBe("instance-url");
  });
});

describe("ensurePlaywrightReady", () => {
  it("deploys then waits when auto-deploy is enabled with a predicted instance URL", async () => {
    const predicted = "https://showcase-developer-hub-showcase-runtime.apps.cluster.example.com";
    const env: Record<string, string | undefined> = {
      BASE_URL: predicted,
      RUNTIME_AUTO_DEPLOY: "true",
    };
    const requestContext = {
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeDeployed = vi.fn(async () => undefined);
    const createRequestContext = vi.fn(async (options: { baseURL: string; ignoreHTTPSErrors: boolean }) => {
      expect(options).toEqual({
        baseURL: predicted,
        ignoreHTTPSErrors: true,
      });
      return requestContext;
    });
    const waitForRhdhReady = vi.fn(async () => undefined);

    await ensurePlaywrightReady({
      env,
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).toHaveBeenCalledOnce();
    expect(createRequestContext).toHaveBeenCalledOnce();
    expect(waitForRhdhReady).toHaveBeenCalledOnce();
    expect(waitForRhdhReady).toHaveBeenCalledWith(requestContext);
    expect(requestContext.dispose).toHaveBeenCalledOnce();
    expect(ensureRuntimeDeployed.mock.invocationCallOrder[0]).toBeLessThan(
      waitForRhdhReady.mock.invocationCallOrder[0],
    );
  });

  it("deploys then waits when BASE_URL is unset and auto-deploy is enabled", async () => {
    const env: Record<string, string | undefined> = {
      RUNTIME_AUTO_DEPLOY: "true",
    };
    const requestContext = {
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeDeployed = vi.fn(async () => {
      env.BASE_URL = "https://showcase-developer-hub-showcase-runtime.apps.cluster.example.com";
    });
    const createRequestContext = vi.fn(async () => requestContext);
    const waitForRhdhReady = vi.fn(async () => undefined);

    await ensurePlaywrightReady({
      env,
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).toHaveBeenCalledOnce();
    expect(waitForRhdhReady).toHaveBeenCalledOnce();
  });

  it("throws when auto-deploy finishes without an instance BASE_URL", async () => {
    await expect(
      ensurePlaywrightReady({
        env: { RUNTIME_AUTO_DEPLOY: "true" },
        ensureRuntimeDeployed: vi.fn(async () => undefined),
        createRequestContext: vi.fn(),
        waitForRhdhReady: vi.fn(),
      }),
    ).rejects.toThrow("Runtime auto-deploy did not produce an instance BASE_URL");
  });

  it("does nothing when BASE_URL is unset and auto-deploy is disabled", async () => {
    const ensureRuntimeDeployed = vi.fn(async () => undefined);
    const createRequestContext = vi.fn(async () => ({
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const waitForRhdhReady = vi.fn(async () => undefined);

    await ensurePlaywrightReady({
      env: {},
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).not.toHaveBeenCalled();
    expect(createRequestContext).not.toHaveBeenCalled();
    expect(waitForRhdhReady).not.toHaveBeenCalled();
  });

  it("does nothing when BASE_URL is only the cluster router", async () => {
    const ensureRuntimeDeployed = vi.fn(async () => undefined);
    const createRequestContext = vi.fn(async () => ({
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    const waitForRhdhReady = vi.fn(async () => undefined);

    await ensurePlaywrightReady({
      env: {
        BASE_URL: "https://apps.cluster.example.com",
        K8S_CLUSTER_ROUTER_BASE: "apps.cluster.example.com",
        RUNTIME_AUTO_DEPLOY: "true",
      },
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).not.toHaveBeenCalled();
    expect(createRequestContext).not.toHaveBeenCalled();
    expect(waitForRhdhReady).not.toHaveBeenCalled();
  });

  it("waits only when BASE_URL points at a deployed instance", async () => {
    const requestContext = {
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeDeployed = vi.fn(async () => undefined);
    const createRequestContext = vi.fn(async () => requestContext);
    const waitForRhdhReady = vi.fn(async () => undefined);

    await ensurePlaywrightReady({
      env: {
        BASE_URL: "https://backstage-showcase-showcase-runtime.apps.cluster.example.com",
      },
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).not.toHaveBeenCalled();
    expect(createRequestContext).toHaveBeenCalledOnce();
    expect(createRequestContext).toHaveBeenCalledWith({
      baseURL: "https://backstage-showcase-showcase-runtime.apps.cluster.example.com",
      ignoreHTTPSErrors: true,
    });
    expect(waitForRhdhReady).toHaveBeenCalledOnce();
    expect(waitForRhdhReady).toHaveBeenCalledWith(requestContext);
    expect(requestContext.dispose).toHaveBeenCalledOnce();
  });
});
