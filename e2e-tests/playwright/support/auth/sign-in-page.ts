import { expect, type Locator, type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations, type Locale } from "../../e2e/localization/locale";

const t = getTranslations();

/**
 * Guest Enter can stay English or follow core-components / packages/app overrides
 * once the app language is seeded (CI: FR shows packages/app "Entrer").
 */
export function guestEnterButton(page: Page, locale?: Locale): Locator {
  const lang = locale ?? getCurrentLanguage();
  const labels = new Set<string>([
    t["core-components"]["en"]["signIn.guestProvider.enter"],
    t["core-components"][lang]["signIn.guestProvider.enter"],
  ]);
  // packages/app FR override; translations/backstage-fr.json still has "Saisir".
  if (lang === "fr") {
    labels.add("Entrer");
  }

  const [first, ...rest] = [...labels];
  return rest.reduce(
    (locator, label) => locator.or(page.getByRole("button", { name: label, exact: true })),
    page.getByRole("button", { name: first, exact: true }),
  );
}

/**
 * Waits for the RHDH app-auth sign-in page ("Select a sign-in method").
 *
 * Title comes from `plugin.app-auth.sign-in` and is English-only today.
 * Guest Enter may be English or localized depending on locale bundles.
 */
export async function waitForRhdhSignInPage(
  page: Page,
  options?: { timeout?: number; locale?: Locale },
): Promise<void> {
  const lang = options?.locale ?? getCurrentLanguage();
  const timeout = options?.timeout ?? 120_000;
  const signInTitle = t["plugin.app-auth.sign-in"]["en"]["signIn.page.title"];

  const signInHeading = page.getByRole("heading", { name: signInTitle });
  const enterButton = guestEnterButton(page, lang);

  await expect(signInHeading).toBeVisible({ timeout });
  await expect(enterButton).toBeVisible();
}
