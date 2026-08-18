import { expect, type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations, type Locale } from "../../e2e/localization/locale";
import { waitForAppReady } from "./app-shell";

const t = getTranslations();

/** How long to wait for app-auth MF hydration before reloading the interim shell. */
const AUTH_HYDRATION_TIMEOUT_MS = 20_000;

/** Reload at most this many times when stuck on the upstream Guest-only shell. */
const MAX_AUTH_SHELL_RELOADS = 2;

async function isVisible(locator: ReturnType<Page["getByRole"]>): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function waitForRhdhSignInReady(
  signInHeading: ReturnType<Page["getByRole"]>,
  guestEnterButton: ReturnType<Page["getByRole"]>,
  remaining: number,
): Promise<boolean> {
  if (await isVisible(signInHeading)) {
    await expect(guestEnterButton).toBeVisible({ timeout: remaining });
    return true;
  }
  return false;
}

async function reloadAfterStalledHydration(page: Page, remaining: number): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page, remaining);
}

/**
 * Waits for the RHDH app-auth sign-in page to replace the interim upstream NFS shell.
 *
 * NFS renders the default @backstage/plugin-app sign-in immediately (heading = app
 * title, Guest only). The app-auth dynamic plugin hydrates via module federation a few
 * seconds later and swaps in the RHDH multi-provider page ("Select a sign-in method").
 *
 * In CI the MF chunk can miss the first paint window; the upstream shell then stays
 * mounted until a reload. When we detect that interim shell (Guest "Enter" visible but
 * not the RHDH heading), we wait briefly for hydration and reload if it never arrives.
 */
export async function waitForRhdhSignInPage(
  page: Page,
  options?: { timeout?: number; locale?: Locale },
): Promise<void> {
  const lang = options?.locale ?? getCurrentLanguage();
  const timeout = options?.timeout ?? 120_000;
  const signInTitle = t["rhdh"][lang]["signIn.page.title"];
  const guestEnterLabel = t["core-components"][lang]["signIn.guestProvider.enter"];

  const signInHeading = page.getByRole("heading", { name: signInTitle });
  const guestEnterButton = page.getByRole("button", { name: guestEnterLabel });

  let reloads = 0;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    if (await waitForRhdhSignInReady(signInHeading, guestEnterButton, remaining)) {
      return;
    }

    if (await isVisible(guestEnterButton)) {
      try {
        await signInHeading.waitFor({
          state: "visible",
          timeout: Math.min(AUTH_HYDRATION_TIMEOUT_MS, remaining),
        });
        await expect(guestEnterButton).toBeVisible();
        return;
      } catch {
        if (reloads >= MAX_AUTH_SHELL_RELOADS) {
          break;
        }
        reloads += 1;
        await reloadAfterStalledHydration(page, remaining);
        continue;
      }
    }

    try {
      await signInHeading.waitFor({
        state: "visible",
        timeout: Math.min(5_000, remaining),
      });
      await expect(guestEnterButton).toBeVisible();
      return;
    } catch {
      // Neither shell is ready yet — keep polling until the deadline.
    }
  }

  await expect(signInHeading).toBeVisible({ timeout: 5_000 });
  await expect(guestEnterButton).toBeVisible();
}
