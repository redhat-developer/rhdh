import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

// Test GitHub Issues plugin functionality
test.describe("GitHub Issues Plugin", () => {
  const showcase = "Backstage Showcase";

  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(180000);
    common = new Common(page);
    await common.loginAsGithubUser();
    uiHelper = new UIhelper(page);
  });

  test("Verify plugin in Extensions page", async ({ page }) => {
    // Navigate to Extensions
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.clickLink("Extensions");
    await uiHelper.clickTab("Installed");

    // Wait for page and search
    await page.waitForSelector(
      'table, [role="grid"], h2:has-text("Extensions")',
      { timeout: 30000 },
    );
    await uiHelper.searchInputPlaceholder("github-issues");

    // Verify plugin exists
    const plugin = page
      .locator(`text="backstage-community-plugin-github-issues"`)
      .first();
    await expect(plugin).toBeVisible({ timeout: 15000 });
  });

  test("Verify Issues tab functionality", async ({ page }) => {
    // Navigate to component and wait for page to be fully loaded
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await Promise.all([
      uiHelper.clickLink(showcase),
      page.waitForLoadState("networkidle", { timeout: 60000 }),
    ]);

    // Open Issues tab after verifying it's visible
    const issuesTab = page.getByRole("tab", { name: "Issues" });
    await expect(issuesTab).toBeVisible({ timeout: 30000 });

    // Click on Issues tab and wait for content to load
    await Promise.all([
      issuesTab.click(),
      page
        .waitForResponse(
          (response) =>
            response.url().includes("github") && response.status() === 200,
          { timeout: 60000 },
        )
        .catch(() => {}),
    ]);

    // Verify GitHub Issues content is visible
    await expect(page.locator('text="Open GitHub Issues"')).toBeVisible({
      timeout: 60000,
    });

    // Simple verification that we're on the issues page
    const url = page.url();
    expect(url).toContain("issues");
  });
});
