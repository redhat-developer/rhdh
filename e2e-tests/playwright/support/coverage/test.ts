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
import { COVERAGE_RAW_DIR } from "./paths";

const isCoverageEnabled = process.env.COLLECT_COVERAGE === "true";

async function startCoverage(page: Page): Promise<void> {
  await page.coverage.startJSCoverage({
    // Keep coverage accumulated across navigations within the same test —
    // resetting would drop coverage from pre-navigation setup steps.
    resetOnNavigation: false,
    // Skip anonymous scripts (injected eval-style code with no URL) —
    // they cannot be mapped back to source and add noise to the report.
    reportAnonymousScripts: false,
  });
}

async function stopCoverage(
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

// Re-exported Playwright names keep their original casing so specs can opt in
// with the idiomatic `import { test, expect } from "..."` pattern. The project
// naming rule requires UPPER_CASE for exported const, but shadowing the
// Playwright convention would force every consumer to alias — worse DX.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = baseTest.extend<NonNullable<unknown>>({
  page: async ({ page }, use, testInfo) => {
    if (isCoverageEnabled) {
      await startCoverage(page);
    }
    await use(page);
    if (isCoverageEnabled) {
      await stopCoverage(
        page,
        testInfo.titlePath,
        testInfo.workerIndex,
        testInfo.retry,
      );
    }
  },
});

// eslint-disable-next-line @typescript-eslint/naming-convention
export const expect = baseExpect;
