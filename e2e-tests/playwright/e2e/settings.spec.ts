import { test } from "@support/coverage/test";

import { SettingsPage } from "../support/pages/settings-page";
import { Common } from "../utils/common";
import { getTranslations, getCurrentLanguage } from "./localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let settingsPage: SettingsPage;

test.describe(`Settings page`, { tag: "@layer3-equivalent" }, () => {
  test.beforeEach(async ({ page }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
    const common = new Common(page);
    settingsPage = new SettingsPage(page);
    await common.loginAsGuest();
    await settingsPage.open();
  });

  // Run tests only for the selected language
  // @cluster-free: verified green on the cluster-free harness (playwright.local.config.ts)
  test(`Verify settings page`, { tag: "@cluster-free" }, async () => {
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

    await settingsPage.uncheckCheckbox(t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"]);
    await settingsPage.verifySidebarMenuItemHidden(t["rhdh"]["fr"]["menuItem.apis"]);
    await settingsPage.checkCheckbox(t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"]);
    // NFS sidebar page titles come from upstream PageBlueprint defaults ("Home"), not
    // rhdh menuItem.* translations — only GlobalHeader chrome translates with AppLanguageApi.
    await settingsPage.verifyText("Home");
  });
});
