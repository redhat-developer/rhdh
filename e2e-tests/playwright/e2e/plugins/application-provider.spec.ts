import { expect } from "@playwright/test";
import { UI_HELPER_ELEMENTS } from "../../support/pageObjects/global-obj";
import { guestTest } from "../../support/fixtures/guest-login";

guestTest.describe("Test ApplicationProvider", () => {
  guestTest(
    "Verify that the TestPage is rendered",
    async ({ page, uiHelper }) => {
      await page.goto("/application-provider-test-page");
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
      expect(contextOneFirstLocator.getByText("1")).toBeVisible();
      expect(contextOneSecondLocator.getByText("1")).toBeVisible();

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
      expect(contextTwoFirstLocator.getByText("1")).toBeVisible();
      expect(contextTwoSecondLocator.getByText("1")).toBeVisible();
    },
  );
});
