import * as path from "path";

import { type Browser, type Cookie, type Page, type TestInfo } from "@playwright/test";

import { startCoverageForPage, stopCoverageForPage } from "../../support/coverage/test";

export function parseAuthStateCookies(content: string): Cookie[] {
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("cookies" in parsed) ||
    !Array.isArray(parsed.cookies)
  ) {
    throw new TypeError("Invalid auth state: expected object with cookies array");
  }
  const rawCookies: unknown[] = parsed.cookies;
  const cookies = rawCookies.filter(
    (cookie): cookie is Cookie =>
      typeof cookie === "object" &&
      cookie !== null &&
      "name" in cookie &&
      typeof cookie.name === "string" &&
      "value" in cookie &&
      typeof cookie.value === "string",
  );
  if (cookies.length !== rawCookies.length) {
    throw new TypeError("Invalid auth state: cookies must have name and value");
  }
  return cookies;
}

function resolveVideoDir(testInfo: TestInfo): string {
  const specStem =
    typeof testInfo.file === "string" && testInfo.file !== ""
      ? path.parse(testInfo.file).name.replace(/\.spec$/u, "")
      : `worker-${testInfo.workerIndex}`;
  const suiteName = testInfo.titlePath?.[1] ?? testInfo.titlePath?.[0] ?? "suite";
  return `test-results/${specStem}/${suiteName}`;
}

export async function setupBrowser(browser: Browser, testInfo: TestInfo) {
  const videoDir = resolveVideoDir(testInfo);

  const context = await browser.newContext({
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();
  await startCoverageForPage(page);

  return { page, context };
}

export async function teardownBrowser(page: Page, testInfo: TestInfo): Promise<void> {
  await stopCoverageForPage(page, testInfo);
  const context = page.context();
  if (!page.isClosed()) {
    await page.close();
  }
  await context.close();
}
