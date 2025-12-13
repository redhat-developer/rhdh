import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import {
  getTranslations,
  getCurrentLanguage,
  getLocale,
} from "./localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let uiHelper: UIhelper;

test.describe(`Settings page`, () => {
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2162
  test.fixme();
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
    await page
      .getByRole("button", {
        name: t["plugin.quickstart"][lang]["footer.hide"],
      })
      .click();
    await expect(page.getByRole("list").first()).toMatchAriaSnapshot(`
    - listitem:
      - text: ${t["user-settings"][lang]["languageToggle.title"]}
      - paragraph: ${t["user-settings"][lang]["languageToggle.description"]}
    `);

    await expect(page.getByTestId("select").locator("div")).toContainText(
      /English|Français|Deutsch/,
    );
    await page
      .getByTestId("select")
      .getByRole("button", { name: /English|Français|Deutsch/ })
      .click();
    await expect(page.getByRole("listbox")).toMatchAriaSnapshot(`
    - listbox:
      - option "English"
      - option "Français"
      - option "Deutsch"
    `);
    await page.getByRole("option", { name: "Français" }).click();
    await expect(page.getByTestId("select").locator("div")).toContainText(
      "Français",
    );

    const fr = getLocale("fr");
    const langfr = "fr";

    await uiHelper.verifyText(fr["user-settings"][langfr]["profileCard.title"]);
    await uiHelper.verifyText(
      fr["user-settings"][langfr]["appearanceCard.title"],
    );
    await uiHelper.verifyText(fr["user-settings"][langfr]["themeToggle.title"]);
    await page.getByTestId("user-settings-menu").click();
    await expect(page.getByTestId("sign-out")).toContainText(
      fr["user-settings"][langfr]["signOutMenu.title"],
    );
    await page.keyboard.press(`Escape`);

    await uiHelper.verifyText(
      fr["user-settings"][langfr]["identityCard.title"],
    );
    await uiHelper.verifyText(
      fr["user-settings"][langfr]["identityCard.userEntity"] + ": Guest User",
    );
    await uiHelper.verifyText(
      fr["user-settings"][langfr]["identityCard.ownershipEntities"] +
        ": Guest User, team-a",
    );

    await uiHelper.verifyText(fr["user-settings"][langfr]["pinToggle.title"]);
    await uiHelper.verifyText(
      fr["user-settings"][langfr]["pinToggle.description"],
    );
    await uiHelper.uncheckCheckbox(
      fr["user-settings"][langfr]["pinToggle.ariaLabelTitle"],
    );
    await expect(
      page.getByText(fr["rhdh"][langfr]["menuItem.apis"]),
    ).toBeHidden();
    await uiHelper.checkCheckbox(
      fr["user-settings"][langfr]["pinToggle.ariaLabelTitle"],
    );
    await uiHelper.verifyText(fr["rhdh"][langfr]["menuItem.home"]);
  });
});
