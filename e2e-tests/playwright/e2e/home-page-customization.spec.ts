import { test } from "@playwright/test";
import { UiHelper } from "../utils/ui-helper";
import { Common } from "../utils/common";

test.describe("Home page customization", () => {
  let common: Common;
  let uiHelper: UiHelper;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UiHelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify that home page is customized", async () => {
    await uiHelper.verifyTextinCard("Quick Access", "Quick Access");
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
});
