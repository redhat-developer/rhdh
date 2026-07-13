import { expect, type Page } from "@playwright/test";

import { getGlobalHeader } from "../../utils/ui-helper/interaction";
import { waitForRhdhReady, isJsonHealthcheckResponse } from "../../utils/wait-for-rhdh-ready";

const LOADING_INDICATOR_SELECTORS = [
  // Intentional divergence: MUI progress bars lack stable roles; class hooks are reliable in CI.
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

export async function hasJsonHealthcheck(page: Page): Promise<boolean> {
  const response = await page.request.get("/healthcheck").catch(() => null);
  if (response === null) {
    return false;
  }
  const contentType = response.headers()["content-type"] ?? "";
  return isJsonHealthcheckResponse(response.status(), contentType);
}

export async function waitForAppReady(page: Page, timeout = 120_000): Promise<void> {
  // Cluster-free legacy harness serves the SPA on BASE_URL; backend readiness is
  // enforced by webServer startup instead of a JSON /healthcheck on the frontend.
  if (await hasJsonHealthcheck(page)) {
    await waitForRhdhReady(page.request, timeout);
  }
  await waitForLoadingToSettle(page, timeout);
}

/**
 * Post-login readiness: OAuth popup close is not "authenticated shell".
 * Wait until the global header (profile dropdown) is visible — the same
 * signal Settings POM navigation depends on.
 */
export async function waitForAuthenticatedShell(page: Page, timeout = 120_000): Promise<void> {
  await waitForAppReady(page, timeout);
  await expect(getGlobalHeader(page)).toBeVisible({ timeout });
}
