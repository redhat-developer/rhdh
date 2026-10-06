import { expect, type Locator, type Page } from "@playwright/test";

import { sleep } from "../../utils/poll-until";
import { waitForRhdhReady, isJsonHealthcheckResponse } from "../../utils/wait-for-rhdh-ready";

const LOADING_INDICATOR_SELECTORS = [
  // Intentional divergence: MUI progress bars lack stable roles; class hooks are reliable in CI.
  'div[class*="MuiLinearProgress-root"]',
  '[class*="MuiCircularProgress-root"]',
] as const;

// Grace period after an uncaught page error before declaring the bootstrap dead.
const PAGE_ERROR_GRACE_MS = 10_000;
const PAGE_ERROR_POLL_INTERVAL_MS = 250;
const MAX_REPORTED_PAGE_ERRORS = 5;

const capturedPageErrors = new WeakMap<Page, Error[]>();

/**
 * Collect uncaught page errors so `waitForLoadingToSettle` can fail fast with
 * the real JS error when the app bootstrap crashes and the loading spinner
 * never clears. Attach before `page.goto` to capture bootstrap-time errors.
 */
export function watchPageErrors(page: Page): Error[] {
  const existing = capturedPageErrors.get(page);
  if (existing) {
    return existing;
  }
  const errors: Error[] = [];
  capturedPageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error));
  return errors;
}

/**
 * Forget previously captured errors and keep watching. Call right before a
 * `page.goto` so a previous document's errors cannot fail the next wait.
 * Deliberately not tied to navigation events: "domcontentloaded" would wipe
 * errors thrown while the new document is still loading, and "framenavigated"
 * also fires for client-side route changes, which would wipe a just-captured
 * bootstrap crash mid-wait.
 */
export function resetPageErrors(page: Page): Error[] {
  const errors = watchPageErrors(page);
  errors.length = 0;
  return errors;
}

export function formatPageErrors(pageErrors: Error[]): string {
  const unique = [...new Set(pageErrors.map((error) => error.message))];
  const shown = unique.slice(0, MAX_REPORTED_PAGE_ERRORS);
  const extra = unique.length - shown.length;
  return shown.join("; ") + (extra > 0 ? `; …and ${extra} more` : "");
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "<page closed>";
  }
}

/**
 * Rejects with the collected page error(s) once the app is stuck: an uncaught
 * error occurred and `indicator` is still visible (or the page died) after a
 * grace period. Resolves silently if the app recovers or `isSettled` flips.
 * Waits on timers, not on the page, so a crashed or closed page cannot mask
 * the real error. Exported for unit tests.
 */
export async function failFastOnPageError(
  page: Page,
  indicator: Locator,
  pageErrors: Error[],
  deadline: number,
  isSettled: () => boolean,
): Promise<void> {
  while (!isSettled() && Date.now() < deadline) {
    if (pageErrors.length === 0) {
      await sleep(PAGE_ERROR_POLL_INTERVAL_MS);
      continue;
    }
    // Give the app a chance to recover before declaring the bootstrap dead.
    await indicator.waitFor({ state: "hidden", timeout: PAGE_ERROR_GRACE_MS }).catch(() => {});
    if (isSettled()) {
      return;
    }
    const stillStuck = page.isClosed() || (await indicator.isVisible().catch(() => true));
    if (stillStuck) {
      throw new Error(
        `App failed to render at ${safeUrl(page)}: loading indicator still visible ` +
          `after uncaught page error(s): ${formatPageErrors(pageErrors)}`,
      );
    }
    return;
  }
}

export async function waitForLoadingToSettle(page: Page, timeout = 120_000): Promise<void> {
  const pageErrors = watchPageErrors(page);
  const deadline = Date.now() + timeout;
  for (const selector of LOADING_INDICATOR_SELECTORS) {
    const indicator = page.locator(selector).first();
    const visible = await indicator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    // The auto-waiting assertion stays the primary wait; the watcher only
    // short-circuits it when an uncaught page error left the spinner stuck.
    const hidden = expect(indicator).toBeHidden({
      timeout: Math.max(deadline - Date.now(), 1),
    });
    let settled = false;
    const watcher = failFastOnPageError(page, indicator, pageErrors, deadline, () => settled);
    try {
      await Promise.race([hidden, watcher]);
    } finally {
      settled = true;
      // The race loser keeps running briefly; swallow its late rejection.
      watcher.catch(() => {});
      hidden.catch(() => {});
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
