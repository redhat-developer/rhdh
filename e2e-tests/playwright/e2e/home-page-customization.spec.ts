import { HomePage } from "../support/pages/home-page";
import { guestTest } from "../support/fixtures/guest-login";

guestTest.describe("Home page customization", () => {
  let homePage: HomePage;

  guestTest.beforeEach(async ({ page }) => {
    homePage = new HomePage(page);
  });

  guestTest("Verify that home page is customized", async ({ uiHelper }) => {
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

  guestTest(
    "Verify that the Top Visited card in the Home page renders without an error",
    async ({ uiHelper }) => {
      await uiHelper.verifyTextinCard("Top Visited", "Top Visited");
      await homePage.verifyVisitedCardContent("Top Visited");
    },
  );

  guestTest(
    "Verify that the Recently Visited card in the Home page renders without an error",
    async ({ uiHelper }) => {
      await uiHelper.verifyTextinCard("Recently Visited", "Recently Visited");
      await homePage.verifyVisitedCardContent("Recently Visited");
    },
  );
});
