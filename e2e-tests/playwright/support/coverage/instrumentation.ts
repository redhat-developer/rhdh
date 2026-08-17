import type { Page, TestInfo, WorkerInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

import { COVERAGE_RAW_DIR } from "./paths";

const isCoverageEnabled = process.env.COLLECT_COVERAGE === "true";

function warn(message: string, err: unknown): void {
  console.warn(`[coverage] ${message}:`, err);
}

async function startJsCoverage(page: Page): Promise<void> {
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
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
    .replaceAll(/[^a-z0-9-]/giu, "_")
    .slice(0, 80);
  const fileName = `${safeTitle}-w${workerIndex}-r${retry}-${Date.now()}.json`;
  await fs.writeFile(
    path.join(COVERAGE_RAW_DIR, fileName),
    JSON.stringify(entries),
  );
}

/** Start V8 JS coverage on the given page (no-op when COLLECT_COVERAGE is unset). */
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

/** Stop V8 JS coverage and write raw entries (no-op when COLLECT_COVERAGE is unset). */
export async function stopCoverageForPage(
  page: Page,
  scope: Pick<TestInfo, "workerIndex"> &
    Partial<Pick<TestInfo, "retry" | "titlePath">> |
    WorkerInfo,
): Promise<void> {
  if (!isCoverageEnabled) {
    return;
  }
  try {
    const titlePath =
      "titlePath" in scope && scope.titlePath !== undefined
        ? scope.titlePath
        : ["worker-session"];
    const retry = "retry" in scope && scope.retry !== undefined ? scope.retry : 0;
    await writeRawCoverage(page, titlePath, scope.workerIndex, retry);
  } catch (err) {
    warn("Failed to stop JS coverage or write raw file", err);
  }
}
