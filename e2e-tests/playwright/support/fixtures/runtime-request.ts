import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";

/** Keep deployment dependencies out of baseURL, which artifact hooks resolve before tests. */
export async function withRuntimeRequest(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  options: Parameters<PlaywrightWorkerArgs["playwright"]["request"]["newContext"]>[0],
  use: (request: APIRequestContext) => Promise<void>,
): Promise<void> {
  const request = await playwright.request.newContext({ ...options, baseURL });
  try {
    await use(request);
  } finally {
    await request.dispose();
  }
}
