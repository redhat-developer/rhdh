import { expect, type Page } from "@playwright/test";
import { test } from "@support/coverage/test";

import { signInAsGuest } from "../support/auth/guest-auth";
import { waitForRhdhSignInPage } from "../support/auth/sign-in-page";
import { getRhdhSidebarNavigation } from "../support/navigation/rhdh-sidebar-adapter";
import { SettingsPage } from "../support/pages/settings-page";
import { getTranslations } from "./localization/locale";

/**
 * Exercises NFS AppLanguageSelector when there is no stored language and
 * api:app/app-language.defaultLanguage is non-English (French).
 *
 * Requires playwright.local-default-language.config.ts (APP_DEFAULT_LANGUAGE=fr).
 * Does not seed localStorage — that path is covered by showcase-localization-* .
 */

const t = getTranslations();
const DEFAULT_LOCALE = "fr" as const;
const DEFAULT_LANGUAGE_LABEL = "Français";

/**
 * Wipe stored language once before the scenario boots. Do not use a lasting
 * addInitScript — that would clear Settings overrides again on every reload.
 */
async function clearStoredLanguage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.removeItem("language");
  });
}

test.describe("NFS defaultLanguage (no stored language)", () => {
  test.beforeEach(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test(
    "applies defaultLanguage before sign-in and after guest login",
    { tag: "@cluster-free-capable" },
    async ({ page }) => {
      await clearStoredLanguage(page);

      await page.goto("/");
      // AppLanguageSelector persists defaultLanguage on first boot.
      await expect
        .poll(async () => page.evaluate(() => window.localStorage.getItem("language")))
        .toBe(DEFAULT_LOCALE);

      // Sign-in heading stays English-only; Guest Enter may follow locale bundles.
      await waitForRhdhSignInPage(page, { locale: DEFAULT_LOCALE });

      await signInAsGuest(page, { locale: DEFAULT_LOCALE, seedLanguage: false });

      await expect(
        page.getByRole("heading", {
          name: t["plugin.homepage"][DEFAULT_LOCALE]["header.welcome"],
        }),
      ).toBeVisible();

      const sidebar = getRhdhSidebarNavigation(page);
      await expect(
        sidebar.getByText(t["plugin.app-react"][DEFAULT_LOCALE]["pages.Catalog"], {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        sidebar.getByText(t["plugin.app-react"][DEFAULT_LOCALE]["pages.Docs"], { exact: true }),
      ).toBeVisible();

      const settingsPage = new SettingsPage(page);
      await settingsPage.open();
      await settingsPage.verifySelectedLanguage(DEFAULT_LANGUAGE_LABEL);
      await settingsPage.verifyLocalizedUserSettingsLabelsWithOwnership(
        DEFAULT_LOCALE,
        "Guest User, team-a",
      );
    },
  );

  test(
    "Settings-chosen language overrides default and survives reload and sign-out",
    { tag: "@cluster-free-capable" },
    async ({ page }) => {
      await clearStoredLanguage(page);
      await signInAsGuest(page, { locale: DEFAULT_LOCALE, seedLanguage: false });

      const settingsPage = new SettingsPage(page);
      await settingsPage.open();
      await settingsPage.verifySelectedLanguage(DEFAULT_LANGUAGE_LABEL);
      await settingsPage.openLanguageSelect();
      await settingsPage.selectLanguage("Deutsch");
      await settingsPage.verifySelectedLanguage("Deutsch");

      await page.reload();
      // After Deutsch, profile menu labels are German — open Settings by URL.
      await page.goto("/settings");
      await settingsPage.verifySelectedLanguage("Deutsch");
      await expect(
        getRhdhSidebarNavigation(page).getByText(t["plugin.app-react"]["de"]["pages.Catalog"], {
          exact: true,
        }),
      ).toBeVisible();

      await settingsPage.signOut();
      await waitForRhdhSignInPage(page, { locale: "de" });
      await signInAsGuest(page, { locale: "de", seedLanguage: false });
      await page.goto("/settings");
      await settingsPage.verifySelectedLanguage("Deutsch");
    },
  );

  test(
    "unavailable stored language falls back to defaultLanguage",
    { tag: "@cluster-free-capable" },
    async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem("language", "xx");
      });

      await page.goto("/");
      await expect
        .poll(async () => page.evaluate(() => window.localStorage.getItem("language")))
        .toBe(DEFAULT_LOCALE);

      await signInAsGuest(page, { locale: DEFAULT_LOCALE, seedLanguage: false });
      const settingsPage = new SettingsPage(page);
      await settingsPage.open();
      await settingsPage.verifySelectedLanguage(DEFAULT_LANGUAGE_LABEL);
    },
  );
});
