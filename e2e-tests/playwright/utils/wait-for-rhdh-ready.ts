import { expect, type APIRequestContext } from "@playwright/test";

/** True when a /healthcheck response indicates the RHDH JSON health endpoint. */
export function isJsonHealthcheckResponse(status: number, contentType: string): boolean {
  return status === 200 && contentType.includes("json");
}

/** Poll the RHDH instance health endpoint until it responds OK. */
export async function waitForRhdhReady(
  request: APIRequestContext,
  timeoutMs = 120_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get("/healthcheck");
        const contentType = response.headers()["content-type"] ?? "";
        if (!isJsonHealthcheckResponse(response.status(), contentType)) {
          return false;
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return false;
        }
        return typeof body === "object" && body !== null && Reflect.get(body, "status") === "ok";
      },
      { timeout: timeoutMs, intervals: [2_000] },
    )
    .toBe(true);
}
