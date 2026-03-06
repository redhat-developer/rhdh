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
  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsGuest();
    await uiHelper.goToSettingsPage();
  });

  // Run tests only for the selected language
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2674
  test.fixme(`Verify settings page`, async ({ page }) => {
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

    // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
    // await uiHelper.verifyText(fr["user-settings"][langfr]["profileCard.title"]);
    await uiHelper.verifyText("Profile");
    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["appearanceCard.title"],
      "Appearance",
    );
    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["themeToggle.title"],
      "Theme",
    );
    await page.getByTestId("user-settings-menu").click();
    await expect(page.getByTestId("sign-out")).toContainText(
      fr["user-settings"][langfr]["signOutMenu.title"],
    );
    await page.keyboard.press(`Escape`);

    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["identityCard.title"],
      "Backstage Identity",
    );
    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["identityCard.userEntity"] + ": Guest User",
      "User Entity" + ": Guest User",
    );
    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["identityCard.ownershipEntities"] +
      "Ownership Entities" + ": Guest User, team-a",
    );

    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["pinToggle.title"],
      "Pin Sidebar",
    );
    await uiHelper.verifyText(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["pinToggle.description"],
      "Prevent the sidebar from collapsing",
    );
    await uiHelper.uncheckCheckbox(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["pinToggle.ariaLabelTitle"],
      "Pin Sidebar Switch",
    );
    await expect(
      page.getByText(fr["rhdh"][langfr]["menuItem.apis"]),
    ).toBeHidden();
    await uiHelper.checkCheckbox(
      // FIX: https://issues.redhat.com/browse/RHDHBUGS-2674 - Strings not getting translated
      // fr["user-settings"][langfr]["pinToggle.ariaLabelTitle"],
      "Pin Sidebar Switch",
    );
    await uiHelper.verifyText(fr["rhdh"][langfr]["menuItem.home"]);
  });
});
