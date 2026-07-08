import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  TestInfo,
  WorkerInfo,
} from "@playwright/test";

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
  contextOptions?: BrowserContextOptions,
): Promise<BrowserSession> {
  const { page, context } = await setupBrowser(browser, contextOptions);
  return {
    page,
    context,
    async teardown(sessionScope: BrowserSessionScope | WorkerInfo): Promise<void> {
      await teardownBrowser(page, sessionScope);
    },
  };
}
