import { type Page } from "@playwright/test";

import { getCurrentLanguage, type Locale } from "../../e2e/localization/locale";
import * as navigation from "../../utils/ui-helper/navigation";
import { resetPageErrors, waitForAppReady } from "./app-shell";
import { guestEnterButton, waitForRhdhSignInPage } from "./sign-in-page";

/**
 * The NFS app picks its language from localStorage `language` or the configured
 * `defaultLanguage`, not from the browser locale. Seed it before the app boots,
 * but keep a value that is already stored (e.g. a language chosen in Settings).
 * English leaves storage unset so the app uses defaultLanguage (en).
 *
 * Pass `seedLanguage: false` to exercise defaultLanguage with an empty store
 * (see playwright.local-default-language.config.ts).
 */
async function seedAppLanguage(page: Page, lang: Locale): Promise<void> {
  if (lang === "en") {
    return;
  }
  await page.addInitScript((language) => {
    if (window.localStorage.getItem("language") === null) {
      window.localStorage.setItem("language", language);
    }
  }, lang);
}

export async function signInAsGuest(
  page: Page,
  options?: {
    timeout?: number;
    locale?: Locale;
    baseURL?: string;
    /** When false, do not write localStorage.language (test defaultLanguage). Default true. */
    seedLanguage?: boolean;
  },
): Promise<void> {
  const lang = options?.locale ?? getCurrentLanguage();
  const timeout = options?.timeout ?? 120_000;
  const seedLanguage = options?.seedLanguage ?? true;

  if (seedLanguage) {
    await seedAppLanguage(page, lang);
  }
  resetPageErrors(page);
  await page.goto(options?.baseURL ?? "/");
  await waitForAppReady(page, timeout);

  page.once("dialog", async (dialog) => {
    console.log(`Dialog message: ${dialog.message()}`);
    await dialog.accept();
  });

  // Title is English-only (plugin.app-auth); Guest Enter may be localized.
  await waitForRhdhSignInPage(page, { timeout, locale: lang });
  await guestEnterButton(page, lang).click();
  await navigation.waitForSideBarVisible(page);
}
