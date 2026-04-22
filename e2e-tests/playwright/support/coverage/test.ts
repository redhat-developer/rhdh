// Jira: RHIDP-13243 — Playwright page.coverage collection for rhdh E2E specs
// Feature umbrella: RHDHPLAN-851, Epic: RHIDP-13242
//
// Extended `test` that auto-collects V8 JS coverage from Chromium during each
// spec when the env var COLLECT_COVERAGE=true is set. With the env var unset
// (the default), this behaves exactly like the base `@playwright/test` and
// adds no measurable overhead.
//
// Usage in a spec:
//   import { test, expect } from "../support/coverage/test";
// Everything else (describe, it, assertions) stays identical.

import {
  test as baseTest,
  expect as baseExpect,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const isCoverageEnabled = process.env.COLLECT_COVERAGE === "true";

const COVERAGE_OUTPUT_DIR =
  process.env.COVERAGE_OUTPUT_DIR ||
  path.join(process.cwd(), "coverage", "e2e-raw");

async function startCoverage(page: Page): Promise<void> {
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    reportAnonymousScripts: false,
  });
}

async function stopCoverage(page: Page, testTitle: string): Promise<void> {
  const entries = await page.coverage.stopJSCoverage();
  if (entries.length === 0) {
    return;
  }
  await fs.mkdir(COVERAGE_OUTPUT_DIR, { recursive: true });
  const safe = testTitle.replace(/[^a-z0-9-]/gi, "_").slice(0, 80);
  const fileName = `${safe}-${Date.now()}.json`;
  await fs.writeFile(
    path.join(COVERAGE_OUTPUT_DIR, fileName),
    JSON.stringify(entries),
  );
}

export const test = baseTest.extend<NonNullable<unknown>>({
  page: async ({ page }, use, testInfo) => {
    if (isCoverageEnabled) {
      await startCoverage(page);
    }
    await use(page);
    if (isCoverageEnabled) {
      await stopCoverage(page, testInfo.title);
    }
  },
});

export const expect = baseExpect;
