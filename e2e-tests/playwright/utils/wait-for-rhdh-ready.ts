import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/** Default timeout for globalSetup / short healthchecks. */
export const RHDH_READY_DEFAULT_TIMEOUT_MS = 120_000;

/** Auth-provider deploy budget — matches K8s deployment wait. */
export const RHDH_READY_DEPLOY_TIMEOUT_MS = 600_000;

/** True when a /healthcheck response indicates the RHDH JSON health endpoint. */
export function isJsonHealthcheckResponse(status: number, contentType: string): boolean {
  return status === 200 && contentType.includes("json");
}

export type HealthcheckProbe = {
  ok: boolean;
  detail: string;
};

/** Minimal HTTP surface for one /healthcheck GET (Playwright APIRequestContext satisfies this). */
export type HealthcheckHttpClient = {
  get: (url: string) => Promise<{
    status: () => number;
    headers: () => Record<string, string>;
    json: () => Promise<unknown>;
  }>;
};

/**
 * Single /healthcheck attempt. Never throws — transport failures (Route down,
 * Playwright request timeout) are `{ ok: false }` so expect.poll can retry for
 * the full readiness budget instead of aborting on the first TimeoutError.
 */
export async function probeHealthcheck(request: HealthcheckHttpClient): Promise<HealthcheckProbe> {
  let response;
  try {
    response = await request.get("/healthcheck");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `request failed: ${message}` };
  }

  const status = response.status();
  const contentType = response.headers()["content-type"] ?? "";

  if (status === 503) {
    return { ok: false, detail: "HTTP 503 from /healthcheck (backend not ready)" };
  }

  if (!isJsonHealthcheckResponse(status, contentType)) {
    return {
      ok: false,
      detail: `HTTP ${status} content-type=${contentType || "(none)"}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, detail: `HTTP ${status} JSON parse failed` };
  }

  if (typeof body === "object" && body !== null && Reflect.get(body, "status") === "ok") {
    return { ok: true, detail: "status ok" };
  }

  return { ok: false, detail: `HTTP ${status} unexpected body` };
}

/** Poll the RHDH instance health endpoint until it responds OK. */
export async function waitForRhdhReady(
  request: APIRequestContext,
  timeoutMs = RHDH_READY_DEFAULT_TIMEOUT_MS,
): Promise<void> {
  let lastDetail = "no response yet";

  try {
    await expect
      .poll(
        async () => {
          const probe = await probeHealthcheck(request);
          lastDetail = probe.detail;
          return probe.ok;
        },
        { timeout: timeoutMs, intervals: [2_000] },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(`RHDH not ready within ${timeoutMs}ms: ${lastDetail}`, { cause: error });
  }
}

/** Open a request context, poll /healthcheck, then dispose. */
export async function healthcheckRhdhAtUrl(
  baseURL: string,
  timeoutMs = RHDH_READY_DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const requestContext = await playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  try {
    await waitForRhdhReady(requestContext, timeoutMs);
  } finally {
    await requestContext.dispose();
  }
}
