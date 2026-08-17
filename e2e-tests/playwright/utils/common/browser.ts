import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  TestInfo,
  WorkerInfo,
} from "@playwright/test";

import { startCoverageForPage, stopCoverageForPage } from "../../support/coverage/instrumentation";

type BrowserScope = Pick<TestInfo, "workerIndex"> &
  Partial<Pick<TestInfo, "retry" | "file" | "titlePath">>;

export async function setupBrowser(
  browser: Browser,
  contextOptions: BrowserContextOptions = {},
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await startCoverageForPage(page);
  return { page, context };
}

export async function teardownBrowser(page: Page, scope: BrowserScope | WorkerInfo): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  await stopCoverageForPage(page, scope);
  const context = page.context();
  if (!page.isClosed()) {
    await page.close();
  }
  const browser = context.browser();
  if (browser !== null && browser.contexts().includes(context)) {
    await context.close();
  }
}
