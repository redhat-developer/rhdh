import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";

test("Verify GitHub Insights plugin is installed", async ({ page }) => {
  const common = new Common(page);
  await common.loginAsGuest();

  const uiHelper = new UIhelper(page);

  // Navigate to Extensions page
  await uiHelper.navigateToExtensions();

  // Wait for the Extensions heading to be visible
  await uiHelper.verifyHeading("Extensions");

  // Search for the GitHub Insights plugin
  await uiHelper.searchInputPlaceholder("github-insights");

  // Verify the plugin row exists and is enabled
  await uiHelper.verifyPluginRow(
    "roadiehq-backstage-plugin-github-insights",
    "Yes",
    "Yes",
  );

  console.log("GitHub Insights plugin is installed and enabled");
});

// Group the remaining tests that actually test the plugin functionality
test.describe("Test GitHub Insights plugin functionality", () => {
  // Reference repository to test (should have GitHub insights configured)
  const repoWithGitHubInsights = "Backstage Showcase";

  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    // Login as GitHub user instead of guest
    await common.loginAsGithubUser();

    uiHelper = new UIhelper(page);

    // Use the helper method for opening catalog
    await uiHelper.openCatalogSidebar("Component");

    // Click on the repo link and wait for entity page heading to appear
    await uiHelper.clickLink(repoWithGitHubInsights);
    await page.waitForSelector("h1", { state: "visible" });

    // Ensure we're on the right page by clicking the Overview tab
    await uiHelper.clickTab("Overview");
  });

  test("Verify GitHub Insights compliance information is available", async ({
    page,
  }) => {
    // Verify the Compliance report card is visible
    await uiHelper.waitForCardWithHeader("Compliance report");

    // Verify specific compliance data is visible
    await uiHelper.verifyTextinCard("Compliance report", "Protected Branches");

    // Verify at least one release branch is visible
    const complianceCard = page.locator(
      UI_HELPER_ELEMENTS.MuiCard("Compliance report"),
    );
    const releaseCount = await complianceCard
      .locator("li")
      .filter({ hasText: /^release-/ })
      .count();
    expect(releaseCount).toBeGreaterThan(0);
    console.log(`Found ${releaseCount} release versions`);

    // Verify license information
    await uiHelper.verifyMultipleTextsInCard("Compliance report", [
      "License",
      "Apache License",
    ]);

    console.log("GitHub Insights compliance information is available");
  });
});
