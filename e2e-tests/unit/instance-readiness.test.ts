import { describe, expect, it, vi } from "vitest";

import { classifyBaseUrlMode, ensurePlaywrightReady } from "../playwright/utils/instance-readiness";

type RequestContextOptions = {
  baseURL: string;
  ignoreHTTPSErrors: boolean;
};

type MockDispose = ReturnType<typeof vi.fn<() => Promise<void>>>;

type MockRequestContext = {
  dispose: MockDispose;
};

function mockRequestContext(): { context: MockRequestContext; dispose: MockDispose } {
  const dispose = vi.fn<() => Promise<void>>().mockResolvedValue();
  return {
    dispose,
    context: { dispose },
  };
}

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
    const { context: requestContext, dispose } = mockRequestContext();
    const ensureRuntimeDeployed = vi.fn<() => Promise<void>>().mockResolvedValue();
    const createRequestContext = vi
      .fn<(options: RequestContextOptions) => Promise<MockRequestContext>>()
      .mockImplementation((options) => {
        expect(options).toEqual({
          baseURL: predicted,
          ignoreHTTPSErrors: true,
        });
        return Promise.resolve(requestContext);
      });
    const waitForRhdhReady = vi
      .fn<(request: MockRequestContext) => Promise<void>>()
      .mockResolvedValue();

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
    expect(dispose).toHaveBeenCalledOnce();
    expect(ensureRuntimeDeployed.mock.invocationCallOrder[0]).toBeLessThan(
      waitForRhdhReady.mock.invocationCallOrder[0],
    );
  });

  it("deploys then waits when BASE_URL is unset and auto-deploy is enabled", async () => {
    const env: Record<string, string | undefined> = {
      RUNTIME_AUTO_DEPLOY: "true",
    };
    const { context: requestContext } = mockRequestContext();
    const ensureRuntimeDeployed = vi.fn<() => Promise<void>>().mockImplementation(() => {
      env.BASE_URL = "https://showcase-developer-hub-showcase-runtime.apps.cluster.example.com";
      return Promise.resolve();
    });
    const createRequestContext = vi
      .fn<(options: RequestContextOptions) => Promise<MockRequestContext>>()
      .mockResolvedValue(requestContext);
    const waitForRhdhReady = vi
      .fn<(request: MockRequestContext) => Promise<void>>()
      .mockResolvedValue();

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
        ensureRuntimeDeployed: vi.fn<() => Promise<void>>().mockResolvedValue(),
        createRequestContext:
          vi.fn<(options: RequestContextOptions) => Promise<MockRequestContext>>(),
        waitForRhdhReady: vi.fn<(request: MockRequestContext) => Promise<void>>(),
      }),
    ).rejects.toThrow("Runtime auto-deploy did not produce an instance BASE_URL");
  });

  it("does nothing when BASE_URL is unset and auto-deploy is disabled", async () => {
    const ensureRuntimeDeployed = vi.fn<() => Promise<void>>().mockResolvedValue();
    const createRequestContext = vi
      .fn<(options: RequestContextOptions) => Promise<MockRequestContext>>()
      .mockResolvedValue(mockRequestContext().context);
    const waitForRhdhReady = vi
      .fn<(request: MockRequestContext) => Promise<void>>()
      .mockResolvedValue();

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

  it("does nothing when BASE_URL is only the cluster router without auto-deploy", async () => {
    const ensureRuntimeDeployed = vi.fn<() => Promise<void>>().mockResolvedValue();
    const createRequestContext = vi
      .fn<(options: RequestContextOptions) => Promise<MockRequestContext>>()
      .mockResolvedValue(mockRequestContext().context);
    const waitForRhdhReady = vi
      .fn<(request: MockRequestContext) => Promise<void>>()
      .mockResolvedValue();

    await ensurePlaywrightReady({
      env: {
        BASE_URL: "https://apps.cluster.example.com",
        K8S_CLUSTER_ROUTER_BASE: "apps.cluster.example.com",
      },
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).not.toHaveBeenCalled();
    expect(createRequestContext).not.toHaveBeenCalled();
    expect(waitForRhdhReady).not.toHaveBeenCalled();
  });

  it("deploys when router-stub BASE_URL is paired with auto-deploy", async () => {
    const env: Record<string, string | undefined> = {
      BASE_URL: "https://apps.cluster.example.com",
      K8S_CLUSTER_ROUTER_BASE: "apps.cluster.example.com",
      RUNTIME_AUTO_DEPLOY: "true",
    };
    const { context: requestContext } = mockRequestContext();
    const ensureRuntimeDeployed = vi.fn<() => Promise<void>>().mockImplementation(() => {
      env.BASE_URL = "https://showcase-developer-hub-showcase-runtime.apps.cluster.example.com";
      return Promise.resolve();
    });
    const createRequestContext = vi
      .fn<(options: RequestContextOptions) => Promise<MockRequestContext>>()
      .mockResolvedValue(requestContext);
    const waitForRhdhReady = vi
      .fn<(request: MockRequestContext) => Promise<void>>()
      .mockResolvedValue();

    await ensurePlaywrightReady({
      env,
      ensureRuntimeDeployed,
      createRequestContext,
      waitForRhdhReady,
    });

    expect(ensureRuntimeDeployed).toHaveBeenCalledOnce();
    expect(waitForRhdhReady).toHaveBeenCalledOnce();
  });

  it("throws when auto-deploy leaves BASE_URL as a router-stub", async () => {
    await expect(
      ensurePlaywrightReady({
        env: {
          BASE_URL: "https://apps.cluster.example.com",
          RUNTIME_AUTO_DEPLOY: "true",
        },
        ensureRuntimeDeployed: vi.fn<() => Promise<void>>().mockResolvedValue(),
        createRequestContext:
          vi.fn<(options: RequestContextOptions) => Promise<MockRequestContext>>(),
        waitForRhdhReady: vi.fn<(request: MockRequestContext) => Promise<void>>(),
      }),
    ).rejects.toThrow("Runtime auto-deploy did not produce an instance BASE_URL");
  });

  it("waits only when BASE_URL points at a deployed instance", async () => {
    const { context: requestContext, dispose } = mockRequestContext();
    const ensureRuntimeDeployed = vi.fn<() => Promise<void>>().mockResolvedValue();
    const createRequestContext = vi
      .fn<(options: RequestContextOptions) => Promise<MockRequestContext>>()
      .mockResolvedValue(requestContext);
    const waitForRhdhReady = vi
      .fn<(request: MockRequestContext) => Promise<void>>()
      .mockResolvedValue();

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
    expect(dispose).toHaveBeenCalledOnce();
  });
});
