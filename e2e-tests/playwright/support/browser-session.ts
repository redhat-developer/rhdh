import { type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { setupBrowser, teardownBrowser } from "../utils/common/browser";

/** Worker-scoped browser session with explicit setup and teardown. */
export class BrowserSession {
  private constructor(
    readonly page: Page,
    readonly context: BrowserContext,
  ) {}

  static async create(browser: Browser, testInfo: TestInfo): Promise<BrowserSession> {
    const { page, context } = await setupBrowser(browser, testInfo);
    return new BrowserSession(page, context);
  }

  async teardown(testInfo: TestInfo): Promise<void> {
    await teardownBrowser(this.page, testInfo);
  }
}
