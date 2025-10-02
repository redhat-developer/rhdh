import { test, expect } from "@playwright/test";
import {
  getTranslations,
  getLocale,
} from "../../support/translations/settings";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

const t = getTranslations();

test.describe(`RHDH Localization - ${t.settings.rhdhLanguage}`, () => {
  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    const uiHelper = new UIhelper(page);
    await common.loginAsGuest();
    await uiHelper.goToPageUrl("/settings", "Settings");
  });

  // Run tests only for the selected language
  test(`Should display correct language section ARIA content in ${t.settings.rhdhLanguage}`, async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByRole("list").first()).toMatchAriaSnapshot(`
    - listitem:
      - text: Language
      - paragraph: Change the language
    `);

    await expect(page.getByTestId("select").locator("div")).toContainText(
      t.settings.rhdhLanguage,
    );
    await page
      .getByTestId("select")
      .getByRole("button", { name: t.settings.rhdhLanguage })
      .click();
    await expect(page.getByRole("listbox")).toMatchAriaSnapshot(`
    - listbox:
      - option "English"
      - option "Français"
      - option "Deutsch"
    `);
    const french = getLocale("fr");
    await page
      .getByRole("option", { name: french.settings.rhdhLanguage })
      .click();
    await expect(page.getByTestId("select").locator("div")).toContainText(
      french.settings.rhdhLanguage,
    );
  });
});
