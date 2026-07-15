import { expect, type Page } from "@playwright/test";

import { getGlobalHeader } from "../../utils/ui-helper/interaction";
import {
  isJsonHealthcheckResponse,
  RHDH_READY_DEFAULT_TIMEOUT_MS,
  waitForRhdhReady,
} from "../../utils/wait-for-rhdh-ready";

/** MUI class hooks — used by a11y scans; avoid role=progressbar there (persistent determinate bars). */
const MUI_LOADING_SELECTORS = [
  'div[class*="MuiLinearProgress-root"]',
  '[class*="MuiCircularProgress-root"]',
] as const;

/**
 * Auth/app readiness also watches role=progressbar — CI stuck paints after reconcile
 * showed only that landmark (no MUI class, no main).
 */
const APP_LOADING_SELECTORS = [...MUI_LOADING_SELECTORS, '[role="progressbar"]'] as const;

/** Brief window for post-reconcile hydrate to mount a loader before settle no-ops. */
const LOADER_APPEAR_BUDGET_MS = 5_000;

async function settleLoaders(
  page: Page,
  selectors: readonly string[],
  timeout: number,
): Promise<void> {
  const loaders = page.locator(selectors.join(", "));
  await loaders
    .first()
    .waitFor({ state: "visible", timeout: Math.min(LOADER_APPEAR_BUDGET_MS, timeout) })
    .catch(() => {});
  for (const selector of selectors) {
    const indicator = page.locator(selector).first();
    const visible = await indicator.isVisible().catch(() => false);
    if (visible) {
      await expect(indicator).toBeHidden({ timeout });
    }
  }
}

/** Wait for MUI loaders only (a11y / generic). Prefer waitForAppReady for auth shells. */
export async function waitForLoadingToSettle(
  page: Page,
  timeout = RHDH_READY_DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await settleLoaders(page, MUI_LOADING_SELECTORS, timeout);
}

export async function hasJsonHealthcheck(page: Page): Promise<boolean> {
  const response = await page.request.get("/healthcheck").catch(() => null);
  if (response === null) {
    return false;
  }
  const contentType = response.headers()["content-type"] ?? "";
  return isJsonHealthcheckResponse(response.status(), contentType);
}

export async function waitForAppReady(
  page: Page,
  timeout = RHDH_READY_DEFAULT_TIMEOUT_MS,
): Promise<void> {
  // Cluster-free legacy harness serves the SPA on BASE_URL; backend readiness is
  // enforced by webServer startup instead of a JSON /healthcheck on the frontend.
  if (await hasJsonHealthcheck(page)) {
    await waitForRhdhReady(page.request, timeout);
  }
  // Include role=progressbar so stuck post-reconcile paints fail here, not later
  // on provider-card expects after waitForAppReady returned green.
  await settleLoaders(page, APP_LOADING_SELECTORS, timeout);
}

/**
 * Post-login readiness: OAuth popup close is not "authenticated shell".
 * Wait until the global header (profile dropdown) is visible — the same
 * signal Settings POM navigation depends on.
 */
export async function waitForAuthenticatedShell(
  page: Page,
  timeout = RHDH_READY_DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitForAppReady(page, timeout);
  await expect(getGlobalHeader(page)).toBeVisible({ timeout });
}

/**
 * After an OAuth popup closes, either the authenticated shell appears (success)
 * or a sign-in alert appears (expected identity-resolution failures).
 *
 * Do not stack a full /healthcheck budget here — reconcile/deploy already proved
 * HTTP. Racing header vs alert is the login locality signal.
 */
export type LoginOutcome = "authenticated" | "error";

const POPUP_SUCCESS_STATUSES = new Set(["Login successful", "Already logged in"]);

export function isPopupLoginSuccess(popupStatus: string): boolean {
  return POPUP_SUCCESS_STATUSES.has(popupStatus);
}

export async function waitForLoginOutcome(
  page: Page,
  timeout = RHDH_READY_DEFAULT_TIMEOUT_MS,
): Promise<LoginOutcome> {
  const header = getGlobalHeader(page);
  const alert = page.getByRole("alert");
  let outcome: LoginOutcome | "pending" = "pending";
  await expect
    .poll(
      async () => {
        if (await header.isVisible().catch(() => false)) {
          outcome = "authenticated";
          return "authenticated";
        }
        if (await alert.isVisible().catch(() => false)) {
          outcome = "error";
          return "error";
        }
        return "pending";
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .not.toBe("pending");
  if (outcome === "pending") {
    throw new Error("Login outcome stayed pending after waitForLoginOutcome");
  }
  return outcome;
}
