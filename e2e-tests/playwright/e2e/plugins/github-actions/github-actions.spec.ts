import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

// Group the tests that test the GitHub Actions plugin functionality
test.describe("Test GitHub Actions plugin functionality", () => {
  // Reference component to test (should have GitHub Actions configured)
  const componentWithGitHubActions = "Backstage Showcase";
  
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    // Increase default timeout to account for slower responses
    test.setTimeout(180000); // 3 minutes
    
    common = new Common(page);
    
    // Login as GitHub user instead of guest
    await common.loginAsGithubUser();
    console.log("Logged in as GitHub user");
    
    uiHelper = new UIhelper(page);
  });

  test("Verify backstage-community-plugin-github-actions in Extensions page", async ({ page }) => {
    // Navigate to Extensions page through Administration
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.clickLink("Extensions");
    console.log("Navigated to Extensions page");
    
    // Click on the Installed tab
    await uiHelper.clickTab("Installed");
    console.log("Clicked on Installed tab");
    
    // Wait for the page to fully load
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
    // Wait for the table to load - using more reliable selector
    await page.waitForSelector('table, div[role="grid"], [data-testid="plugins-table"]', { timeout: 30000 });
    await page.waitForTimeout(3000); // Add a delay to ensure the table is fully rendered
    
    // Search for the GitHub Actions plugin - use a shorter search term to improve matching
    const pluginName = "backstage-community-plugin-github-actions";
    const searchTerm = "github-actions"; // Use a shorter, more distinctive part of the name
    await uiHelper.searchInputPlaceholder(searchTerm);
    console.log(`Searching for plugin with term: ${searchTerm}`);
    
    // Wait for search results
    await page.waitForTimeout(2000);
    
    // Check if the plugin is in the table - with more flexible approach
    const pluginRow = page.locator(`tr:has-text("${pluginName}")`).first();
    await expect(pluginRow).toBeVisible({ timeout: 10000 });
    console.log("Found plugin row in table");
    
    // Instead of using verifyCellsInTable, we'll check more directly
    const nameCell = pluginRow.locator('td').first();
    await expect(nameCell).toContainText("github-actions");
    
    // Verify plugin status (Enabled and Preinstalled should both be "Yes")
    const enabledCell = pluginRow.locator('td').nth(2);
    const preinstalledCell = pluginRow.locator('td').nth(3);
    await expect(enabledCell).toContainText("Yes");
    await expect(preinstalledCell).toContainText("Yes");
    
    // Additional check for the role
    const roleCell = pluginRow.locator('td').nth(4);
    await expect(roleCell).toContainText("frontend-plugin");
    
    console.log("Successfully verified GitHub Actions plugin in Extensions page");
  });

  test("Verify CI tab is available and accessible", async ({ page }) => {
    // Navigate to the component page using UIhelper
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink(componentWithGitHubActions);
    console.log(`Navigated to ${componentWithGitHubActions} component`);
    
    // Wait for page to fully load with extended timeouts
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 });
    
    // Check if CI tab exists and click it
    const ciTab = page.getByRole('tab', { name: 'CI' }).first();
    await expect(ciTab).toBeVisible({ timeout: 30000 });
    await ciTab.click();
    console.log("Successfully clicked CI tab");
    
    // Wait for GitHub Actions table to be visible
    await page.waitForSelector('table', { timeout: 30000 });
    
    console.log("Successfully verified CI tab is accessible");
  });
}); 