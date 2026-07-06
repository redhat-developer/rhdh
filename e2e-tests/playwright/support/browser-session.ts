import { type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { setupBrowser, teardownBrowser } from "../utils/common/browser";

export type BrowserSession = {
  page: Page;
  context: BrowserContext;
  teardown(testInfo: TestInfo): Promise<void>;
};

/** Worker-scoped browser session with explicit setup and teardown. */
export async function createBrowserSession(
  browser: Browser,
  testInfo: TestInfo,
): Promise<BrowserSession> {
  const { page, context } = await setupBrowser(browser, testInfo);
  return {
    page,
    context,
    async teardown(sessionTestInfo: TestInfo): Promise<void> {
      await teardownBrowser(page, sessionTestInfo);
    },
  };
}
