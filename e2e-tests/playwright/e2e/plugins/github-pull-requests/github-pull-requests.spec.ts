import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";

// Test to verify if the GitHub Pull Requests plugin is installed - runs independently
test("Verify GitHub GitHub Pull Requests plugin is installed", async ({ page }) => {
  const common = new Common(page);
  await common.loginAsGuest();

  const uiHelper = new UIhelper(page);

  // Navigate to the Administration in the sidebar
  await uiHelper.openSidebarButton("Administration");

  // Click on Extensions
  await uiHelper.openSidebar("Extensions");

  // Wait for the page to load
  await page.waitForLoadState("networkidle");

  // Verify Extensions page heading is visible
  await uiHelper.verifyHeading("Extensions");

  // Make sure we're on the Installed tab
  await uiHelper.clickTab("Installed");

  // Search for the GitHub GitHub Pull Requests plugin
  await uiHelper.searchInputPlaceholder("github-pull-requests");

  // Verify the plugin row exists and is enabled
  await uiHelper.verifyPluginRow(
    "roadiehq-backstage-plugin-github-pull-requests",
    "Yes",
    "Yes",
  );

  console.log("GitHub Pull Requests plugin is installed and enabled");
});

// Group the remaining tests that actually test the plugin functionality
test.describe("Test GitHub Pull Requests plugin functionality", () => {
  // Reference repository to test (should have GitHub Pu configured)
  const repoWithGitHubPullRequests = "Backstage Showcase";

  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    // Login as GitHub user instead of guest
    await common.loginAsGithubUser();

    uiHelper = new UIhelper(page);
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink(repoWithGitHubPullRequests);

    // Wait for entity page to load
    await page.waitForLoadState("networkidle");

    // Ensure we're on the right page by clicking the Overview tab
    await uiHelper.clickTab("Overview");
  });

  test("Verify GitHub Pull Requests information is available", async ({
    page,
  }) => {
    // Verify the GitHub Pull Requests card is visible
    await uiHelper.waitForCardWithHeader("GitHub Pull Requests Statistics");

    // Verify specific PR data is visible
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", "Average Time Of PR Until Merge");
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", "Merged To Closed Ratio");
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", "Average Size Of PR");
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", "Average Changed Files Of PR");
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", "Average Coding Time Of PR");
   
    console.log("GitHub Pull Requests information is available");
  });
});