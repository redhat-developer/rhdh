import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { HomePageCustomization } from "../support/pages/home-page-customization";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe.serial("Dynamic Home Page Customization", () => {
  let common: Common;
  let homePageCustomization: HomePageCustomization;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    homePageCustomization = new HomePageCustomization(page);
    await common.loginAsKeycloakUser();
  });

  test("Verify Cards Display After Login", async ({ page }, testInfo) => {
    await homePageCustomization.verifyHomePageLoaded();
    await homePageCustomization.verifyAllCardsDisplayed();
    await homePageCustomization.verifyEditButtonVisible();
    await runAccessibilityTests(page, testInfo);
  });

  test("Verify All Cards Can Be Resized in Edit Mode", async ({
    page,
  }, testInfo) => {
    await homePageCustomization.enterEditMode();
    await homePageCustomization.resizeAllCards();
    await homePageCustomization.exitEditMode();
    await runAccessibilityTests(page, testInfo);
  });

  test("Verify Cards Can Be Individually Deleted in Edit Mode", async ({
    page,
  }, testInfo) => {
    await homePageCustomization.enterEditMode();
    await homePageCustomization.deleteAllCards();
    await homePageCustomization.verifyCardsDeleted();
    await runAccessibilityTests(page, testInfo);
  });

  test("Verify Restore Default Cards", async ({ page }, testInfo) => {
    await homePageCustomization.restoreDefaultCards();
    await homePageCustomization.verifyCardsRestored();
    await runAccessibilityTests(page, testInfo);
  });

  test("Verify All Cards can be Deleted with Clear all Button", async ({
    page,
  }, testInfo) => {
    await homePageCustomization.enterEditMode();
    await homePageCustomization.clearAllCardsWithButton();
    await homePageCustomization.verifyCardsDeleted();
    await runAccessibilityTests(page, testInfo);
  });

  test("Verify Add Widget Button Adds Cards", async ({ page }, testInfo) => {
    await homePageCustomization.addWidget("OnboardingSection");
    await expect(
      page.getByText(/Good (morning|afternoon|evening)/),
    ).toBeVisible();
    await homePageCustomization.enterEditMode();

    await homePageCustomization.addWidget("EntitySection");
    await expect(page.getByText("Explore Your Software Catalog")).toBeVisible();

    await homePageCustomization.addWidget("JokeCard");
    await expect(page.getByText("Random Joke")).toBeVisible();

    await homePageCustomization.addWidget("RecentlyVisitedCard");
    await expect(page.getByText("Recently Visited")).toBeVisible();

    await homePageCustomization.addWidget("TopVisitedCard");
    await expect(page.getByText("Top Visited")).toBeVisible();

    await runAccessibilityTests(page, testInfo);
  });
});
