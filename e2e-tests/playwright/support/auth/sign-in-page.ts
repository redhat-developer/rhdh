import { expect, type Page } from "@playwright/test";

import { getTranslations, type Locale } from "../../e2e/localization/locale";

const t = getTranslations();

/**
 * Waits for the RHDH app-auth sign-in page ("Select a sign-in method").
 *
 * `plugin.app-auth.sign-in` currently ships English-only strings, so assertions
 * use English regardless of the Playwright / app locale. Locale is accepted for
 * call-site compatibility only.
 */
export async function waitForRhdhSignInPage(
  page: Page,
  options?: { timeout?: number; locale?: Locale },
): Promise<void> {
  const timeout = options?.timeout ?? 120_000;
  const signInTitle = t["plugin.app-auth.sign-in"]["en"]["signIn.page.title"];
  const guestEnterLabel = t["core-components"]["en"]["signIn.guestProvider.enter"];

  const signInHeading = page.getByRole("heading", { name: signInTitle });
  const guestEnterButton = page.getByRole("button", { name: guestEnterLabel });

  await expect(signInHeading).toBeVisible({ timeout });
  await expect(guestEnterButton).toBeVisible();
}
