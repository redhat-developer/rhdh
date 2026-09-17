import { expect, type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations, type Locale } from "../../e2e/localization/locale";

const t = getTranslations();

/**
 * Waits for the RHDH app-auth sign-in page ("Select a sign-in method").
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

  await expect(signInHeading).toBeVisible({ timeout });
  await expect(guestEnterButton).toBeVisible();
}
