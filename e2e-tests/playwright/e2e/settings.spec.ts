import { expect } from "@playwright/test";
import { test } from "@support/coverage/test";

import { getRhdhSidebarNavigation } from "../support/navigation/rhdh-sidebar-adapter";
import { SettingsPage } from "../support/pages/settings-page";
import { getTranslations, getCurrentLanguage } from "./localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let settingsPage: SettingsPage;

test.describe(`Settings page`, { tag: "@layer3-equivalent" }, () => {
  test.beforeEach(async ({ guestPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
    settingsPage = new SettingsPage(guestPage);
    await settingsPage.open();
  });

  test(`Verify settings page`, { tag: "@cluster-free-capable" }, async ({ guestPage }) => {
    await settingsPage.hideQuickstartIfVisible();
    await settingsPage.verifyLanguageToggleList(lang);
    await settingsPage.verifyLanguageSelectShowsOptions();
    await settingsPage.openLanguageSelect();
    await settingsPage.verifyLanguageOptionsList();
    await settingsPage.selectLanguage("Français");
    await settingsPage.verifySelectedLanguage("Français");

    await settingsPage.verifyLocalizedUserSettingsLabelsWithOwnership("fr", "Guest User, team-a");
    await settingsPage.openUserSettingsMenu();
    await settingsPage.verifySignOutMenuLabel(t["user-settings"]["fr"]["signOutMenu.title"]);
    await settingsPage.closeUserSettingsMenu();

    await settingsPage.verifySidebarMenuItemVisible(t["rhdh"]["fr"]["menuItem.apis"]);
    await settingsPage.uncheckCheckbox(t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"]);
    await settingsPage.verifySidebarMenuItemHidden(t["rhdh"]["fr"]["menuItem.apis"]);
    await settingsPage.checkCheckbox(t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"]);
    // The app-defaults sidebar labels this page "Home" or "Accueil", depending
    // on the installed plugin version. Check the text link, not the Home logo.
    await expect(
      getRhdhSidebarNavigation(guestPage)
        .getByRole("link", { name: /^(?:Home|Accueil)$/u })
        .filter({ hasText: /^(?:Home|Accueil)$/u }),
    ).toBeVisible();
  });
});
