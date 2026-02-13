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
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsGuest();
  });

  test("Verify that the TestPage is rendered", async ({ page }) => {
    await uiHelper.goToPageUrl("/application-provider-test-page");
    await common.waitForLoad();
    await uiHelper.verifyText("application/provider TestPage");
    await uiHelper.verifyText(
      "This card will work only if you register the TestProviderOne and TestProviderTwo correctly.",
    );

    // Verify Context one cards are visible
    await uiHelper.verifyTextinCard("Context one", "Context one");

    // Find all card containers within main article that contain "Context one"
    const contextOneCards = page
      .locator("main article")
      .locator("> div > div") // Direct children that are card containers
      .filter({ hasText: "Context one" });

    // Click increment on the first Context one card
    await contextOneCards.first().getByRole("button", { name: "+" }).click();

    // Verify both Context one cards show count of 1 (shared state)
    await expect(
      contextOneCards.first().getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      contextOneCards.last().getByRole("heading", { name: "1" }),
    ).toBeVisible();

    // Verify Context two cards are visible
    await uiHelper.verifyTextinCard("Context two", "Context two");

    // Find all card containers that contain "Context two"
    const contextTwoCards = page
      .locator("main article")
      .locator("> div > div")
      .filter({ hasText: "Context two" });

    // Click increment on the first Context two card
    await contextTwoCards.first().getByRole("button", { name: "+" }).click();

    // Verify both Context two cards show count of 1 (shared state)
    await expect(
      contextTwoCards.first().getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      contextTwoCards.last().getByRole("heading", { name: "1" }),
    ).toBeVisible();
  });
});
