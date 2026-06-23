import { expect, test } from "@support/coverage/test";
import { Common } from "../../utils/common";
import { ApplicationProviderTestPage } from "../../support/pages/application-provider-test-page";

test.describe("Test ApplicationProvider", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let applicationProviderPage: ApplicationProviderTestPage;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    applicationProviderPage = new ApplicationProviderTestPage(page);
    await common.loginAsGuest();
  });

  test("Verify that the TestPage is rendered", async ({ page }) => {
    await applicationProviderPage.open();
    await common.waitForLoad();
    await applicationProviderPage.verifyTestPageContent();

    // Verify Context one cards are visible
    await applicationProviderPage.verifyContextOneCard();

    // Find card containers within main article that contain "Context one"
    /* oxlint-disable playwright/no-raw-locators -- per-card containers are nested divs inside one article */
    const contextOneCards = page
      .getByRole("main")
      .getByRole("article")
      .locator("> div > div")
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
    await applicationProviderPage.verifyContextTwoCard();

    // Find card containers that contain "Context two"
    const contextTwoCards = page
      .getByRole("main")
      .getByRole("article")
      .locator("> div > div")
      .filter({ hasText: "Context two" });
    /* oxlint-enable playwright/no-raw-locators */

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
