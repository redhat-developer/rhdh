import * as path from "node:path";

import type { Browser, BrowserContext, Page, TestInfo, WorkerInfo } from "@playwright/test";

import { startCoverageForPage, stopCoverageForPage } from "../../support/coverage/instrumentation";

type BrowserScope = Pick<TestInfo, "workerIndex"> &
  Partial<Pick<TestInfo, "retry" | "file" | "titlePath">>;

function getSpecStem(scope: BrowserScope | WorkerInfo): string {
  if ("file" in scope && scope.file !== undefined && scope.file !== "") {
    return path.parse(scope.file).name.replace(/\.spec$/u, "");
  }
  return `worker-${scope.workerIndex}`;
}

function getSuiteName(scope: BrowserScope | WorkerInfo): string {
  if ("titlePath" in scope && scope.titlePath !== undefined) {
    return scope.titlePath[1] ?? scope.titlePath[0] ?? "suite";
  }
  return "suite";
}

function resolveVideoDir(scope: BrowserScope | WorkerInfo): string {
  return `test-results/${getSpecStem(scope)}/${getSuiteName(scope)}`;
}

export async function setupBrowser(
  browser: Browser,
  scope: BrowserScope | WorkerInfo,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    recordVideo: {
      dir: resolveVideoDir(scope),
      size: { width: 1280, height: 720 },
    },
  });
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
