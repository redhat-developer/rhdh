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

    // Get both Context one cards (they share state)
    const contextOneCards = page
      .getByRole("article")
      .filter({ hasText: "Context one" });
    const firstContextOneCard = contextOneCards.first();
    const secondContextOneCard = contextOneCards.last();

    // Click the + button in the first Context one card
    await firstContextOneCard.getByRole("button", { name: "+" }).click();

    // Verify count is now 1 in both Context one cards (shared state)
    await expect(
      firstContextOneCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      secondContextOneCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();

    // Verify Context two cards are visible
    await uiHelper.verifyTextinCard("Context two", "Context two");

    // Get both Context two cards (they share state)
    const contextTwoCards = page
      .getByRole("article")
      .filter({ hasText: "Context two" });
    const firstContextTwoCard = contextTwoCards.first();
    const secondContextTwoCard = contextTwoCards.last();

    // Click the + button in the first Context two card
    await firstContextTwoCard.getByRole("button", { name: "+" }).click();

    // Verify count is now 1 in both Context two cards (shared state)
    await expect(
      firstContextTwoCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      secondContextTwoCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();
  });
});
