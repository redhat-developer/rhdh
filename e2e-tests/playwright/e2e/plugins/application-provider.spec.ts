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

    // Use heading as anchor to find card containers (cards are divs, not articles)
    const contextOneHeadings = page
      .locator("main")
      .getByText("Context one", { exact: true });

    // Get first Context one card's container and click its increment button
    const firstContextOneCard = contextOneHeadings.first().locator("..");
    await firstContextOneCard.getByRole("button", { name: "+" }).click();

    // Verify both Context one cards show count of 1 (shared state)
    await expect(
      contextOneHeadings.first().locator("..").getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      contextOneHeadings.last().locator("..").getByRole("heading", { name: "1" }),
    ).toBeVisible();

    // Verify Context two cards are visible
    await uiHelper.verifyTextinCard("Context two", "Context two");

    // Use heading as anchor to find card containers
    const contextTwoHeadings = page
      .locator("main")
      .getByText("Context two", { exact: true });

    // Get first Context two card's container and click its increment button
    const firstContextTwoCard = contextTwoHeadings.first().locator("..");
    await firstContextTwoCard.getByRole("button", { name: "+" }).click();

    // Verify both Context two cards show count of 1 (shared state)
    await expect(
      contextTwoHeadings.first().locator("..").getByRole("heading", { name: "1" }),
    ).toBeVisible();
    await expect(
      contextTwoHeadings.last().locator("..").getByRole("heading", { name: "1" }),
    ).toBeVisible();
  });
});
