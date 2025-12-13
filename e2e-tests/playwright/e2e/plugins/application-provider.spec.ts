import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";
import { UI_HELPER_ELEMENTS } from "../../support/page-objects/global-obj";

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
    await uiHelper.verifyTextinCard("Context one", "Context one");

    const contextOneFirstLocator = page
      .locator(UI_HELPER_ELEMENTS.MuiCard("Context one"))
      .first();
    const contextOneSecondLocator = page
      .locator(UI_HELPER_ELEMENTS.MuiCard("Context one"))
      .last();
    const contextOneIncrementButton = contextOneFirstLocator
      .locator("button")
      .filter({ hasText: "+" });
    await contextOneIncrementButton.click();
    await expect(contextOneFirstLocator.getByText("1")).toBeVisible();
    await expect(contextOneSecondLocator.getByText("1")).toBeVisible();

    await uiHelper.verifyTextinCard("Context two", "Context two");
    const contextTwoFirstLocator = page
      .locator(UI_HELPER_ELEMENTS.MuiCard("Context two"))
      .first();
    const contextTwoSecondLocator = page
      .locator(UI_HELPER_ELEMENTS.MuiCard("Context two"))
      .last();
    const contextTwoIncrementButton = contextTwoFirstLocator
      .locator("button")
      .filter({ hasText: "+" });
    await contextTwoIncrementButton.click();
    await expect(contextTwoFirstLocator.getByText("1")).toBeVisible();
    await expect(contextTwoSecondLocator.getByText("1")).toBeVisible();
  });
});
