// Jira: RHIDP-13243 — Playwright page.coverage collection for rhdh E2E specs
// Feature umbrella: RHDHPLAN-851, Epic: RHIDP-13242
//
// Extended `test` that auto-collects V8 JS coverage from Chromium during each
// spec when the env var COLLECT_COVERAGE=true is set. With the env var unset
// (the default), this behaves exactly like the base `@playwright/test` and
// adds no measurable overhead.
//
// Usage in a spec using the built-in { page } fixture:
//   import { test, expect } from "@support/coverage/test";
//
// For specs that create their own context/page via browser.newContext(),
// import the helpers directly and call them around the test body:
//   import { startCoverageForPage, stopCoverageForPage } from "@support/coverage/test";
//
// Everything else (describe, it, assertions) stays identical.

import {
  test as baseTest,
  expect as baseExpect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { COVERAGE_RAW_DIR } from "./paths";

const isCoverageEnabled = process.env.COLLECT_COVERAGE === "true";

function warn(message: string, err: unknown): void {
  console.warn(`[coverage] ${message}:`, err);
}

async function startJsCoverage(page: Page): Promise<void> {
  await page.coverage.startJSCoverage({
    // Keep coverage accumulated across navigations within the same test —
    // resetting would drop coverage from pre-navigation setup steps.
    resetOnNavigation: false,
    // Skip anonymous scripts (injected eval-style code with no URL) —
    // they cannot be mapped back to source and add noise to the report.
    reportAnonymousScripts: false,
  });
}

async function writeRawCoverage(
  page: Page,
  titlePath: string[],
  workerIndex: number,
  retry: number,
): Promise<void> {
  const entries = await page.coverage.stopJSCoverage();
  if (entries.length === 0) {
    return;
  }
  await fs.mkdir(COVERAGE_RAW_DIR, { recursive: true });
  const safeTitle = titlePath
    .join("_")
    .replace(/[^a-z0-9-]/gi, "_")
    .slice(0, 80);
  const fileName = `${safeTitle}-w${workerIndex}-r${retry}-${Date.now()}.json`;
  await fs.writeFile(
    path.join(COVERAGE_RAW_DIR, fileName),
    JSON.stringify(entries),
  );
}

/**
 * Start V8 JS coverage on the given page. Safe to call even when
 * COLLECT_COVERAGE is unset — it becomes a no-op in that case. Errors are
 * logged but never thrown, so coverage collection cannot fail a test.
 *
 * Use this from specs that manage their own BrowserContext/Page via
 * browser.newContext() and therefore bypass the auto-instrumented { page }
 * fixture. Specs that use the default { page } fixture do not need to call
 * this directly — the fixture handles it automatically.
 */
export async function startCoverageForPage(page: Page): Promise<void> {
  if (!isCoverageEnabled) {
    return;
  }
  try {
    await startJsCoverage(page);
  } catch (err) {
    warn("Failed to start JS coverage", err);
  }
}

/**
 * Stop V8 JS coverage for the given page and write the raw V8 entries to
 * COVERAGE_RAW_DIR. Safe to call even when COLLECT_COVERAGE is unset — it
 * becomes a no-op. Errors are logged but never thrown.
 */
export async function stopCoverageForPage(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (!isCoverageEnabled) {
    return;
  }
  try {
    await writeRawCoverage(
      page,
      testInfo.titlePath,
      testInfo.workerIndex,
      testInfo.retry,
    );
  } catch (err) {
    warn("Failed to stop JS coverage or write raw file", err);
  }
}

// Re-exported Playwright names keep their original casing so specs can opt in
// with the idiomatic `import { test, expect } from "..."` pattern. The project
// naming rule requires UPPER_CASE for exported const, but shadowing the
// Playwright convention would force every consumer to alias — worse DX.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = baseTest.extend<NonNullable<unknown>>({
  page: async ({ page }, use, testInfo) => {
    await startCoverageForPage(page);
    await use(page);
    await stopCoverageForPage(page, testInfo);
  },
});

// eslint-disable-next-line @typescript-eslint/naming-convention
export const expect = baseExpect;
