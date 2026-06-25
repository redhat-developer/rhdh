import * as path from "node:path";

import { type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { startCoverageForPage, stopCoverageForPage } from "../../support/coverage/test";

function resolveVideoDir(testInfo: TestInfo): string {
  const specStem =
    typeof testInfo.file === "string" && testInfo.file !== ""
      ? path.parse(testInfo.file).name.replace(/\.spec$/u, "")
      : `worker-${testInfo.workerIndex}`;
  const suiteName = testInfo.titlePath?.[1] ?? testInfo.titlePath?.[0] ?? "suite";
  return `test-results/${specStem}/${suiteName}`;
}

export async function setupBrowser(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    recordVideo: {
      dir: resolveVideoDir(testInfo),
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();
  await startCoverageForPage(page);
  return { page, context };
}

export async function teardownBrowser(page: Page, testInfo: TestInfo): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  await stopCoverageForPage(page, testInfo);
  const context = page.context();
  if (!page.isClosed()) {
    await page.close();
  }
  const browser = context.browser();
  if (browser !== null && browser.contexts().includes(context)) {
    await context.close();
  }
}
