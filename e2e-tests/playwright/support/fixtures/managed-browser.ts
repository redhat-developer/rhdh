import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { setupBrowser, teardownBrowser } from "../../utils/common-browser";

export type ManagedBrowserSession = {
  page: Page;
  context: BrowserContext;
  dispose: () => Promise<void>;
};

/** Paired setup/teardown for specs that share one browser context in beforeAll. */
export async function createManagedBrowserSession(
  browser: Browser,
  testInfo: TestInfo,
): Promise<ManagedBrowserSession> {
  const { page, context } = await setupBrowser(browser, testInfo);
  return {
    page,
    context,
    dispose: async () => {
      await teardownBrowser(page, testInfo);
    },
  };
}
