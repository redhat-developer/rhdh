import { type APIRequestContext } from "@playwright/test";

import { ensureRuntimeDeployed } from "./runtime-deploy";
import { healthcheckRhdhAtUrl } from "./wait-for-rhdh-ready";

export type BaseUrlMode = "unset" | "router-stub" | "instance-url";

type ReadinessEnv = Record<string, string | undefined>;

type RequestContextOptions = {
  baseURL: string;
  ignoreHTTPSErrors: boolean;
};

type DisposableRequestContext = {
  dispose(): Promise<void>;
};

type EnsurePlaywrightReadyDeps<TContext extends DisposableRequestContext> = {
  env?: ReadinessEnv;
  ensureRuntimeDeployed?: () => Promise<void>;
  createRequestContext?: (options: RequestContextOptions) => Promise<TContext>;
  waitForRhdhReady?: (request: TContext) => Promise<void>;
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

async function healthcheckWithDeps<TContext extends DisposableRequestContext>(
  baseURL: string,
  createRequestContext: (options: RequestContextOptions) => Promise<TContext>,
  waitForReady: (request: TContext) => Promise<void>,
): Promise<void> {
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

/**
 * Resolve Playwright readiness before any project runs.
 *
 * Modes:
 * - RUNTIME_AUTO_DEPLOY=true → ensure runtime is deployed, then healthcheck
 *   (runs even if BASE_URL was initially a router-stub; deploy must produce
 *   an instance URL)
 * - router-stub (without auto-deploy) → no-op
 * - instance-url → healthcheck only (CI predeployed)
 * - unset → no-op
 *
 * Runtime CI must still pass a predicted instance URL as BASE_URL so
 * `playwright.config.ts` freezes a usable `use.baseURL` before this runs.
 */
export async function ensurePlaywrightReady<
  TContext extends DisposableRequestContext = APIRequestContext,
>({
  env = process.env,
  ensureRuntimeDeployed: deployRuntime = ensureRuntimeDeployed,
  createRequestContext,
  waitForRhdhReady: waitForReady,
}: EnsurePlaywrightReadyDeps<TContext> = {}): Promise<void> {
  let baseUrlMode = classifyBaseUrlMode(env);

  if (env.RUNTIME_AUTO_DEPLOY === "true") {
    await deployRuntime();
    baseUrlMode = classifyBaseUrlMode(env);
    if (baseUrlMode !== "instance-url") {
      throw new Error("Runtime auto-deploy did not produce an instance BASE_URL");
    }
  } else if (baseUrlMode === "router-stub") {
    return;
  }

  if (baseUrlMode !== "instance-url") {
    return;
  }

  const baseURL = normalizeEnvValue(env.BASE_URL);
  if (baseURL === undefined) {
    return;
  }

  if (createRequestContext !== undefined && waitForReady !== undefined) {
    await healthcheckWithDeps(baseURL, createRequestContext, waitForReady);
    return;
  }

  await healthcheckRhdhAtUrl(baseURL);
}
