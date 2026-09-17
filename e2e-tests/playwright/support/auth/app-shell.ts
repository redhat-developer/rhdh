import { expect, type Page } from "@playwright/test";

import { waitForRhdhReady, isJsonHealthcheckResponse } from "../../utils/wait-for-rhdh-ready";

const LOADING_INDICATOR_SELECTORS = [
  // Intentional divergence: MUI progress bars lack stable roles; class hooks are reliable in CI.
  'div[class*="MuiLinearProgress-root"]',
  '[class*="MuiCircularProgress-root"]',
] as const;

// Grace period after an uncaught page error before declaring the bootstrap dead.
const PAGE_ERROR_GRACE_MS = 10_000;
const LOADING_POLL_INTERVAL_MS = 250;

const pageErrorLogs = new WeakMap<Page, Error[]>();

/**
 * Collect uncaught page errors so `waitForLoadingToSettle` can fail fast with
 * the real JS error when the app bootstrap crashes and the loading spinner
 * never clears. Attach before `page.goto` to capture bootstrap-time errors.
 * Errors are reset on every main-frame navigation so stale errors from a
 * previous page cannot fail a later wait.
 */
export function watchPageErrors(page: Page): void {
  if (pageErrorLogs.has(page)) {
    return;
  }
  const errors: Error[] = [];
  pageErrorLogs.set(page, errors);
  page.on("pageerror", (error) => errors.push(error));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      errors.length = 0;
    }
  });
}

export async function waitForLoadingToSettle(page: Page, timeout = 120_000): Promise<void> {
  watchPageErrors(page);
  const pageErrors = pageErrorLogs.get(page) ?? [];
  for (const selector of LOADING_INDICATOR_SELECTORS) {
    const indicator = page.locator(selector).first();
    const deadline = Date.now() + timeout;
    let visible = await indicator.isVisible().catch(() => false);
    while (visible) {
      if (pageErrors.length > 0) {
        // A crashed bootstrap never clears the spinner; surface the real JS
        // error instead of burning the full toBeHidden timeout.
        await page.waitForTimeout(PAGE_ERROR_GRACE_MS);
        visible = await indicator.isVisible().catch(() => false);
        if (visible) {
          throw new Error(
            `App failed to render (loading indicator "${selector}" still visible) ` +
              `after uncaught page error(s): ${pageErrors.map((error) => error.message).join("; ")}`,
          );
        }
        break;
      }
      if (Date.now() >= deadline) {
        await expect(indicator).toBeHidden({ timeout: 1_000 });
        break;
      }
      await page.waitForTimeout(LOADING_POLL_INTERVAL_MS);
      visible = await indicator.isVisible().catch(() => false);
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
