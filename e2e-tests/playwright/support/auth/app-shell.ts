import { expect, type Page } from "@playwright/test";

import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";

const LOADING_INDICATOR_SELECTORS = [
  'div[class*="MuiLinearProgress-root"]',
  '[class*="MuiCircularProgress-root"]',
] as const;

export async function waitForLoadingToSettle(page: Page, timeout = 120_000): Promise<void> {
  for (const selector of LOADING_INDICATOR_SELECTORS) {
    const indicator = page.locator(selector).first();
    const visible = await indicator.isVisible().catch(() => false);
    if (visible) {
      await expect(indicator).toBeHidden({ timeout });
    }
  }
}

export async function waitForAppReady(page: Page, timeout = 120_000): Promise<void> {
  await waitForRhdhReady(page.request, timeout);
  await waitForLoadingToSettle(page, timeout);
}
