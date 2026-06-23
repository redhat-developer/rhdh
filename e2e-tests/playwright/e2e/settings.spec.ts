import { test, expect } from "@support/coverage/test";
import { Common } from "../utils/common";
import { SettingsPage } from "../support/pages/settings-page";
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
  test(`Verify settings page`, async ({ page }) => {
    await settingsPage.hideQuickstartIfVisible();
    await expect(page.getByRole("list").first()).toMatchAriaSnapshot(`
    - listitem:
      - text: ${t["user-settings"][lang]["languageToggle.title"]}
      - paragraph: ${t["user-settings"][lang]["languageToggle.description"]}
    `);

    await expect(page.getByTestId("select")).toContainText(
      /English|Deutsch|Español|Français|Italiano|日本語/u,
    );
    await page
      .getByTestId("select")
      .getByRole("button", {
        name: /English|Deutsch|Español|Français|Italiano|日本語/u,
      })
      .click();
    await expect(page.getByRole("listbox")).toMatchAriaSnapshot(`
    - listbox:
      - option "English"
      - option "Deutsch"
      - option "Español"
      - option "Français"
      - option "Italiano"
      - option "日本語"
    `);
    await page.getByRole("option", { name: "Français" }).click();
    await expect(page.getByTestId("select")).toContainText("Français");

    await settingsPage.verifyLocalizedUserSettingsLabelsWithOwnership(
      "fr",
      "Guest User, team-a",
    );
    await page.getByTestId("user-settings-menu").click();
    await expect(page.getByTestId("sign-out")).toContainText(
      t["user-settings"]["fr"]["signOutMenu.title"],
    );
    await page.keyboard.press(`Escape`);

    await settingsPage.uncheckCheckbox(
      t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"],
    );
    await expect(page.getByText(t["rhdh"]["fr"]["menuItem.apis"])).toBeHidden();
    await settingsPage.checkCheckbox(
      t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"],
    );
    await settingsPage.verifyText(t["rhdh"]["fr"]["menuItem.home"]);
  });
});
