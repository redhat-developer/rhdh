import { type Page } from "@playwright/test";
import fs from "fs";

export async function downloadAndReadFile(
  page: Page,
  locator: string,
): Promise<string | undefined> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(locator).click(),
  ]);

  const filePath = await download.path();

  if (filePath) {
    return fs.readFileSync(filePath, "utf-8");
  } else {
    console.error("Download failed or path is not available");
    return undefined;
  }
}