import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";

import { ensureRuntimeDeployed } from "./runtime-deploy";
import { waitForRhdhReady } from "./wait-for-rhdh-ready";

export type BaseUrlMode = "unset" | "router-stub" | "instance-url";

type ReadinessEnv = Record<string, string | undefined>;

type RequestContextOptions = {
  baseURL: string;
  ignoreHTTPSErrors: boolean;
};

type RequestContextLike = {
  dispose(): Promise<void>;
};

type EnsurePlaywrightReadyDeps = {
  env?: ReadinessEnv;
  ensureRuntimeDeployed?: () => Promise<void>;
  createRequestContext?: (options: RequestContextOptions) => Promise<RequestContextLike>;
  waitForRhdhReady?: (request: RequestContextLike) => Promise<void>;
};

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Auth-providers CI historically passed only the cluster router base
 * (`https://apps.<cluster>`) as BASE_URL. That is not an RHDH instance.
 */
function isRouterStub(baseUrl: URL, routerBase: string | undefined): boolean {
  if (
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.pathname !== "/" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    return false;
  }

  const hostname = baseUrl.hostname.toLowerCase();
  if (routerBase !== undefined && hostname === routerBase.toLowerCase()) {
    return true;
  }

  // Exact router host only — real RHDH routes are `<name>.apps.<cluster>`.
  return hostname.startsWith("apps.");
}

export function classifyBaseUrlMode(env: ReadinessEnv): BaseUrlMode {
  const baseUrl = normalizeEnvValue(env.BASE_URL);
  if (baseUrl === undefined) {
    return "unset";
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    return "instance-url";
  }

  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    return "instance-url";
  }

  return isRouterStub(parsedBaseUrl, normalizeEnvValue(env.K8S_CLUSTER_ROUTER_BASE))
    ? "router-stub"
    : "instance-url";
}

const defaultCreateRequestContext = async (
  options: RequestContextOptions,
): Promise<RequestContextLike> => playwrightRequest.newContext(options);

const defaultWaitForRhdhReady = async (request: RequestContextLike): Promise<void> => {
  await waitForRhdhReady(request as APIRequestContext);
};

/**
 * Resolve Playwright readiness before any project runs.
 *
 * Modes:
 * - router-stub → no-op (auth harness self-deploys; do not probe the router)
 * - RUNTIME_AUTO_DEPLOY=true → ensure runtime is deployed, then healthcheck
 * - instance-url → healthcheck only (CI predeployed)
 * - unset → no-op
 *
 * Runtime CI must still pass a predicted instance URL as BASE_URL so
 * `playwright.config.ts` freezes a usable `use.baseURL` before this runs.
 */
export async function ensurePlaywrightReady({
  env = process.env,
  ensureRuntimeDeployed: deployRuntime = ensureRuntimeDeployed,
  createRequestContext = defaultCreateRequestContext,
  waitForRhdhReady: waitForReady = defaultWaitForRhdhReady,
}: EnsurePlaywrightReadyDeps = {}): Promise<void> {
  let baseUrlMode = classifyBaseUrlMode(env);

  if (baseUrlMode === "router-stub") {
    return;
  }

  if (env.RUNTIME_AUTO_DEPLOY === "true") {
    await deployRuntime();
    baseUrlMode = classifyBaseUrlMode(env);
    if (baseUrlMode !== "instance-url") {
      throw new Error("Runtime auto-deploy did not produce an instance BASE_URL");
    }
  }

  if (baseUrlMode !== "instance-url") {
    return;
  }

  const baseURL = normalizeEnvValue(env.BASE_URL);
  if (baseURL === undefined) {
    return;
  }

  const requestContext = await createRequestContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });

  try {
    await waitForReady(requestContext);
  } finally {
    await requestContext.dispose();
  }
}
