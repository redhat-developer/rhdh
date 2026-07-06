import type { Browser, BrowserContext, Page, TestInfo, WorkerInfo } from "@playwright/test";

import { setupBrowser, teardownBrowser } from "../utils/common/browser";

/** Minimal Playwright scope info used for worker-scoped browser sessions. */
export type BrowserSessionScope = Pick<TestInfo, "workerIndex"> &
  Partial<Pick<TestInfo, "retry" | "file" | "titlePath">>;

export type BrowserSession = {
  page: Page;
  context: BrowserContext;
  teardown(sessionInfo: BrowserSessionScope): Promise<void>;
};

/** Worker-scoped browser session with explicit setup and teardown. */
export async function createBrowserSession(
  browser: Browser,
  sessionInfo: BrowserSessionScope | WorkerInfo,
): Promise<BrowserSession> {
  const { page, context } = await setupBrowser(browser, sessionInfo);
  return {
    page,
    context,
    async teardown(sessionScope: BrowserSessionScope | WorkerInfo): Promise<void> {
      await teardownBrowser(page, sessionScope);
    },
  };
}
