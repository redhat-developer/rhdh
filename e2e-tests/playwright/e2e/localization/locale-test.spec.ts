import { test, expect } from "@playwright/test";
import { getTranslations } from "../../support/translations/settings";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

const t = getTranslations();

test.describe(`RHDH Localization - ${t.settings.rhdhLanguage}`, () => {
  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    const uiHelper = new UIhelper(page);
    await common.loginAsGuest();
    await uiHelper.goToSettingsPage();
  });

  // Run tests only for the selected language
  test(`Should display correct language section ARIA content in ${t.settings.rhdhLanguage}`, async ({
    page,
  }) => {
    const enterButton = page.getByRole("button", { name: "Enter" });
    await expect(enterButton).toBeVisible();
    await enterButton.click();
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByRole("list").first()).toMatchAriaSnapshot(`
    - listitem:
      - text: Language
      - paragraph: Change the language
    `);

    await expect(page.getByTestId("select").locator("div")).toContainText(
      t.settings.rhdhLanguage,
    );
  });
});
