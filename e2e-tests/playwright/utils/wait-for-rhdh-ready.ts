import { expect, type APIRequestContext } from "@playwright/test";

export { waitForNextTotpWindow } from "./poll-until";

/** Poll the RHDH instance health endpoint until it responds OK. */
export async function waitForRhdhReady(
  request: APIRequestContext,
  timeoutMs = 120_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get("/healthcheck");
        if (response.status() !== 200) {
          return false;
        }
        const body: unknown = await response.json();
        return (
          typeof body === "object" &&
          body !== null &&
          Reflect.get(body, "status") === "ok"
        );
      },
      { timeout: timeoutMs, intervals: [2_000] },
    )
    .toBe(true);
}
