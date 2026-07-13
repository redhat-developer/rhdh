import { type APIRequestContext } from "@playwright/test";

import { resolveInstallMethod } from "./helper";
import { isPredictedRuntimeUrl } from "./instance-route-identity";
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
  resolveInstallMethod?: () => "helm" | "operator";
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

/**
 * RUNTIME_AUTO_DEPLOY must only rewrite / redeploy when the invocation is
 * clearly targeting the runtime project. CI should scope the flag to the
 * runtime Playwright run; this gate is defense-in-depth against export leaks
 * that would otherwise redeploy runtime and stomp BASE_URL for later projects.
 */
export function shouldAutoDeployRuntime(
  env: ReadinessEnv,
  installMethod: "helm" | "operator" = resolveInstallMethod(),
): boolean {
  if (env.RUNTIME_AUTO_DEPLOY !== "true") {
    return false;
  }

  const mode = classifyBaseUrlMode(env);
  if (mode === "unset" || mode === "router-stub") {
    return true;
  }

  const baseUrl = normalizeEnvValue(env.BASE_URL);
  const routerBase = normalizeEnvValue(env.K8S_CLUSTER_ROUTER_BASE);
  if (baseUrl === undefined || routerBase === undefined) {
    // Predicted instance URL without router base — allow only when hostname
    // still matches the runtime formula using router base from the URL itself.
    if (baseUrl === undefined) {
      return false;
    }
    try {
      const host = new URL(baseUrl).hostname;
      const appsIdx = host.indexOf(".apps.");
      if (appsIdx === -1) {
        return false;
      }
      const inferredRouterBase = host.slice(appsIdx + 1);
      return isPredictedRuntimeUrl(baseUrl, installMethod, inferredRouterBase, env);
    } catch {
      return false;
    }
  }

  return isPredictedRuntimeUrl(baseUrl, installMethod, routerBase, env);
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
 * - RUNTIME_AUTO_DEPLOY=true targeting runtime → ensure deployed, then healthcheck
 * - RUNTIME_AUTO_DEPLOY=true but BASE_URL is a non-runtime instance → healthcheck only
 *   (ignores the leaked flag)
 * - router-stub (without eligible auto-deploy) → no-op
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
  resolveInstallMethod: resolveMethod = resolveInstallMethod,
}: EnsurePlaywrightReadyDeps<TContext> = {}): Promise<void> {
  let baseUrlMode = classifyBaseUrlMode(env);
  const autoDeploy = shouldAutoDeployRuntime(env, resolveMethod());

  if (autoDeploy) {
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
