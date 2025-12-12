import { test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import { HomePage } from "../support/pages/home-page";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Home page customization", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let homePage: HomePage;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    homePage = new HomePage(page);
    await common.loginAsGuest();
  });

  test("Verify that home page is customized", async ({ page }, testInfo) => {
    await uiHelper.verifyTextinCard("Quick Access", "Quick Access");

    await runAccessibilityTests(page, testInfo);

    await uiHelper.verifyTextinCard(
      "Your Starred Entities",
      "Your Starred Entities",
    );
    await uiHelper.verifyHeading("Placeholder tests");
    await uiHelper.verifyDivHasText("Home page customization test 1");
    await uiHelper.verifyDivHasText("Home page customization test 2");
    await uiHelper.verifyDivHasText("Home page customization test 3");
    await uiHelper.verifyHeading("Markdown tests");
    await uiHelper.verifyTextinCard("Company links", "Company links");
    await uiHelper.verifyHeading("Important company links");
    await uiHelper.verifyHeading("RHDH");
    await uiHelper.verifyTextinCard("Featured Docs", "Featured Docs");
    await uiHelper.verifyTextinCard("Random Joke", "Random Joke");
    await uiHelper.clickButton("Reroll");
  });

  test("Verify that the Top Visited card in the Home page renders without an error", async () => {
    await uiHelper.verifyTextinCard("Top Visited", "Top Visited");
    await homePage.verifyVisitedCardContent("Top Visited");
  });

  test("Verify that the Recently Visited card in the Home page renders without an error", async () => {
    await uiHelper.verifyTextinCard("Recently Visited", "Recently Visited");
    await homePage.verifyVisitedCardContent("Recently Visited");
  });
});
