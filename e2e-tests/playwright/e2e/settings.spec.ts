import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { getTranslations, getCurrentLanguage } from "./localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let uiHelper: UIhelper;

test.describe(`Settings page`, () => {
  test.beforeEach(async ({ page }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
    const common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsGuest();
    await uiHelper.goToPageUrl(
      "/settings",
      t["user-settings"][lang]["settingsLayout.title"],
    );
  });

  // Run tests only for the selected language
  test(`Verify settings page`, async ({ page }) => {
    await uiHelper.hideQuickstartIfVisible();
    await expect(page.getByRole("list").first()).toMatchAriaSnapshot(`
    - listitem:
      - text: ${t["user-settings"][lang]["languageToggle.title"]}
      - paragraph: ${t["user-settings"][lang]["languageToggle.description"]}
    `);

    await expect(page.getByTestId("select")).toContainText(
      /English|Français|Italiano|日本語|Deutsch/,
    );
    await page
      .getByTestId("select")
      .getByRole("button", { name: /English|Français|Italiano|日本語|Deutsch/ })
      .click();
    await expect(page.getByRole("listbox")).toMatchAriaSnapshot(`
    - listbox:
      - option "English"
      - option "Français"
      - option "Italiano"
      - option "日本語"
      - option "Deutsch"
    `);
    await page.getByRole("option", { name: "Français" }).click();
    await expect(page.getByTestId("select")).toContainText("Français");

    await uiHelper.verifyText(t["user-settings"]["fr"]["profileCard.title"]);
    await uiHelper.verifyText(t["user-settings"]["fr"]["appearanceCard.title"]);
    await uiHelper.verifyText(t["user-settings"]["fr"]["themeToggle.title"]);
    await page.getByTestId("user-settings-menu").click();
    await expect(page.getByTestId("sign-out")).toContainText(
      t["user-settings"]["fr"]["signOutMenu.title"],
    );
    await page.keyboard.press(`Escape`);

    await uiHelper.verifyText(t["user-settings"]["fr"]["identityCard.title"]);
    await uiHelper.verifyText(
      t["user-settings"]["fr"]["identityCard.userEntity"] + ": Guest User",
    );
    await uiHelper.verifyText(
      t["user-settings"]["fr"]["identityCard.ownershipEntities"] +
        ": Guest User, team-a",
    );

    await uiHelper.verifyText(t["user-settings"]["fr"]["pinToggle.title"]);
    await uiHelper.verifyText(
      t["user-settings"]["fr"]["pinToggle.description"],
    );
    await uiHelper.uncheckCheckbox(
      t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"],
    );
    await expect(page.getByText(t["rhdh"]["fr"]["menuItem.apis"])).toBeHidden();
    await uiHelper.checkCheckbox(
      t["user-settings"]["fr"]["pinToggle.ariaLabelTitle"],
    );
    await uiHelper.verifyText(t["rhdh"]["fr"]["menuItem.home"]);
  });
});
