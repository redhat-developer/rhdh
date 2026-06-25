import { test } from "@support/coverage/test";

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

  // Run tests only for the selected language
  test(`Verify settings page`, async () => {
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
    await settingsPage.verifyText(t["rhdh"]["fr"]["menuItem.home"]);
  });
});
