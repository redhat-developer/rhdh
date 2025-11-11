import { type Page, type Locator } from "@playwright/test";
import fs from "fs";
import type { JobPattern } from "./constants";

export async function downloadAndReadFile(
  page: Page,
  locator: Locator,
): Promise<string | undefined> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    locator.click(),
  ]);

  const filePath = await download.path();

  if (filePath) {
    return fs.readFileSync(filePath, "utf-8");
  } else {
    console.error("Download failed or path is not available");
    return undefined;
  }
}

/**
 * Helper function to skip tests based on JOB_NAME environment variable
 * @param jobNamePattern - Pattern to match in JOB_NAME (use JOB_PATTERNS constants)
 * @returns boolean - true if test should be skipped
 * @example
 * import { JOB_PATTERNS } from "./constants";
 * test.skip(() => shouldSkipBasedOnJob(JOB_PATTERNS.OSD_GCP));
 */
export function shouldSkipBasedOnJob(jobNamePattern: JobPattern): boolean {
  return process.env.JOB_NAME?.includes(jobNamePattern) ?? false;
}
