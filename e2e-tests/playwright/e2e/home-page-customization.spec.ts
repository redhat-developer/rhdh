import { test } from "@support/coverage/test";

import { HomePage } from "../support/pages/home-page";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Home page customization", () => {
  let homePage: HomePage;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(({ guestPage }) => {
    homePage = new HomePage(guestPage);
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test(
    "Verify that home page is customized",
    { tag: "@cluster-free" },
    async ({ page }, testInfo) => {
      await homePage.verifyTextInCard("Quick Access", "Quick Access");

      await runAccessibilityTests(page, testInfo);

      await homePage.verifyTextInCard("Your Starred Entities", "Your Starred Entities");
      await homePage.verifyHeading("Placeholder tests");
      await homePage.verifyDivHasText("Home page customization test 1");
      await homePage.verifyDivHasText("Home page customization test 2");
      await homePage.verifyDivHasText("Home page customization test 3");
      await homePage.verifyHeading("Markdown tests");
      await homePage.verifyTextInCard("Company links", "Company links");
      await homePage.verifyHeading("Important company links");
      await homePage.verifyHeading("RHDH");
      await homePage.verifyTextInCard("Featured Docs", "Featured Docs");
      await homePage.verifyTextInCard("Random Joke", "Random Joke");
      await homePage.clickButton("Reroll");
    },
  );

  test(
    "Verify that the Top Visited card in the Home page renders without an error",
    { tag: "@cluster-free" },
    async () => {
      await homePage.verifyTextInCard("Top Visited", "Top Visited");
      await homePage.verifyVisitedCardContent("Top Visited");
    },
  );

  test(
    "Verify that the Recently Visited card in the Home page renders without an error",
    { tag: "@cluster-free" },
    async () => {
      await homePage.verifyTextInCard("Recently Visited", "Recently Visited");
      await homePage.verifyVisitedCardContent("Recently Visited");
    },
  );

  test("Verify Customized Quick Access", async () => {
    // Expanded by default
    await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
    await homePage.verifyQuickAccess("CI/CD Tools", ["ArgoCD", "SonarQube", "Quay.io"]);
    await homePage.verifyQuickAccess("OpenShift Clusters", "OpenShift");
    // Collapsed by default
    await homePage.verifyQuickAccess("Monitoring Tools", "Grafana", true);
    await homePage.verifyQuickAccess("Security Tools", ["GitHub Security", "Keycloak"], true);
  });
});
