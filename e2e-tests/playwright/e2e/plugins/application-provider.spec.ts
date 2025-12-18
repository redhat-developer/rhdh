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

    // Get all card containers (children of the main grid)
    const allCards = page.locator("main article > div:first-child > div");

    // Context one cards are index 0 and 1
    const firstContextOneCard = allCards.nth(0);
    const secondContextOneCard = allCards.nth(1);

    await firstContextOneCard.getByRole("button", { name: "+" }).click();

    await expect(
      firstContextOneCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      secondContextOneCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();

    // Verify Context two cards are visible
    await uiHelper.verifyTextinCard("Context two", "Context two");

    // Context two cards are index 2 and 3
    const firstContextTwoCard = allCards.nth(2);
    const secondContextTwoCard = allCards.nth(3);

    await firstContextTwoCard.getByRole("button", { name: "+" }).click();

    await expect(
      firstContextTwoCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      secondContextTwoCard.getByRole("heading", { name: "1" }),
    ).toBeVisible();
  });
});
