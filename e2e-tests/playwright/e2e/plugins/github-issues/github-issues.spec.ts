import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

// Variables definition
const pluginId = "github-issues";
const pluginName = "backstage-community-plugin-github-issues";
const showcaseComponent = "Backstage Showcase";
const issuesTabName = "Issues";
const openIssuesText = "Open GitHub Issues";

// Timeout values
const defaultTimeout = 60000;
const shortTimeout = 15000;
const mediumTimeout = 30000;

// Test GitHub Issues plugin functionality
test.describe("GitHub Issues Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(defaultTimeout);
    common = new Common(page);
    await common.loginAsGithubUser();
    uiHelper = new UIhelper(page);
  });

  test("Verify plugin in Extensions page", async ({ page }) => {
    await uiHelper.navigateToExtensions();
    await uiHelper.searchInputPlaceholder(pluginId);

    const plugin = page.locator(`text="${pluginName}"`).first();
    await expect(plugin).toBeVisible({ timeout: shortTimeout });
  });

  test("Verify Issues tab functionality", async ({ page }) => {
    await uiHelper.navigateToComponentIssues(showcaseComponent, issuesTabName);

    await page
      .waitForResponse(
        (response) =>
          response.url().includes("github") && response.status() === 200,
        { timeout: defaultTimeout },
      )
      .catch((error) => {
        console.warn(
          "GitHub API response may not have been detected:",
          error.message,
        );
      });

    await expect(page.locator(`text="${openIssuesText}"`)).toBeVisible({
      timeout: mediumTimeout,
    });

    const url = page.url();
    expect(url).toMatch(/\/issues$/);
  });
});
