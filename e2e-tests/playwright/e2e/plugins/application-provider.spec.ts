import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";

test.describe("Test ApplicationProvider", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsGuest();
  });

  test("Verify that the TestPage is rendered", async ({ page }) => {
    await uiHelper.goToPageUrl("/application-provider-test-page");
    await uiHelper.verifyText("application/provider TestPage");
    await uiHelper.verifyText(
      "This card will work only if you register the TestProviderOne and TestProviderTwo correctly.",
    );

    // Verify Context one cards are visible
    await uiHelper.verifyTextinCard("Context one", "Context one");

    // Click the first + button (Context one card)
    await page.getByRole("button", { name: "+" }).first().click();

    // Verify count is now 1 (shared state between both Context one cards)
    const countTexts = page.getByText("1", { exact: true });
    await expect(countTexts.first()).toBeVisible();
    await expect(countTexts.nth(1)).toBeVisible();

    // Verify Context two cards are visible
    await uiHelper.verifyTextinCard("Context two", "Context two");

    // Click the third + button (first Context two card)
    await page.getByRole("button", { name: "+" }).nth(2).click();

    // Verify count is now 1 for Context two cards as well
    await expect(countTexts.nth(2)).toBeVisible();
    await expect(countTexts.nth(3)).toBeVisible();
  });
});
