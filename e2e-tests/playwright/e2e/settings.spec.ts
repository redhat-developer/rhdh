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

  test(`Verify settings page`, { tag: "@cluster-free-capable" }, async () => {
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

    const apisLabel = t["rhdh"]["fr"]["menuItem.apis"];
    await settingsPage.uncheckCheckbox(t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"]);
    await settingsPage.verifySidebarItemCollapsed(apisLabel);
    await settingsPage.checkCheckbox(t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"]);
    await settingsPage.verifySidebarItemExpanded(apisLabel);
    // NFS sidebar page titles come from upstream PageBlueprint defaults ("Home"), not
    // rhdh menuItem.* translations — only GlobalHeader chrome translates with AppLanguageApi.
    await settingsPage.verifyText("Home");
  });
});
