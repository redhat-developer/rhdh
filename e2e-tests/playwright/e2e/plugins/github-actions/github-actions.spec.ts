import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

/**
 * Test suite for GitHub Actions plugin functionality
 * These tests verify that the GitHub Actions plugin is correctly installed and
 * functioning within the RHDH platform.
 */
test.describe("Test GitHub Actions plugin functionality", () => {
  // Component known to have GitHub Actions configured for testing
  const componentWithGitHubActions = "Backstage Showcase";
  
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {    
    common = new Common(page);
    
    // GitHub authentication required for accessing Actions data
    await common.loginAsGithubUser();
    console.log("Logged in as GitHub user");
    
    uiHelper = new UIhelper(page);
  });

  /**
   * Verifies that the GitHub Actions plugin is properly installed
   * and enabled in the Extensions page.
   */
  test("Verify backstage-community-plugin-github-actions in Extensions page", async ({ page }) => {
    // Navigate to Extensions page through Administration panel
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.clickLink("Extensions");
    console.log("Navigated to Extensions page");
    
    // Focus on installed plugins to filter out available plugins
    await uiHelper.clickTab("Installed");
    console.log("Clicked on Installed tab");
    
    // The table may take time to load due to plugin data fetching
    await page.waitForSelector('table, div[role="grid"], [data-testid="plugins-table"]', { timeout: 30000 });
    
    // Search specifically for the GitHub Actions plugin
    const pluginName = "backstage-community-plugin-github-actions";
    const searchTerm = "github-actions";
    await uiHelper.searchInputPlaceholder(searchTerm);
    console.log(`Searching for plugin with term: ${searchTerm}`);
    
    // Verify the plugin's activation status (both should be "Yes")
    await uiHelper.verifyPluginRow(pluginName, "Yes", "Yes");
    
    // Additionally check that the plugin has the correct role type
    const pluginRow = page.locator(`tr:has-text("${pluginName}")`).first();
    const roleCell = pluginRow.locator('td').nth(4);
    await expect(roleCell).toContainText("frontend-plugin");
    
    console.log("Successfully verified GitHub Actions plugin in Extensions page");
  });

  /**
   * Verifies that the CI tab appears in component details and
   * can display GitHub Actions workflow information.
   */
  test("Verify CI tab is available and accessible", async ({ page }) => {
    // Navigate to the catalog filtered by Component kind
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink(componentWithGitHubActions);
    console.log(`Navigated to ${componentWithGitHubActions} component`);
    
    // The CI tab should be visible when GitHub Actions plugin is properly configured
    const ciTab = page.getByRole('tab', { name: 'CI' }).first();
    await expect(ciTab).toBeVisible({ timeout: 30000 });
    await ciTab.click();
    console.log("Successfully clicked CI tab");
    
    // GitHub Actions workflows should appear in a table format
    await page.waitForSelector('table', { timeout: 30000 });
    
    console.log("Successfully verified CI tab is accessible");
  });
}); 