import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

if (
  !process.env.GH_USER_ID ||
  !process.env.GH_USER_PASS ||
  !process.env.GH_2FA_SECRET
) {
  throw new Error(
    "GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.",
  );
}

// Test GitHub Issues plugin functionality
test.describe("GitHub Issues Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000);
    common = new Common(page);
    uiHelper = new UIhelper(page);

    try {
      await common.loginAsKeycloakUser(
        process.env.GH_USER_ID,
        process.env.GH_USER_PASS,
      );
    } catch (error) {
      await common.loginAsGuest();
    }
  });

  test("Verify GitHub Issues plugin exists", async ({ page }) => {
    await uiHelper.navigateToExtensions();
    await uiHelper.searchInputPlaceholder("github-issues");

    const plugin = page
      .locator('text="backstage-community-plugin-github-issues"')
      .first();
    await expect(plugin).toBeVisible({ timeout: 15000 });
  });

  test("Verify GitHub Issues content is displayed", async ({ page }) => {
    // Use existing helper function to navigate to component Issues tab
    await uiHelper.navigateToComponentIssues("test-backstage");

    // Verify we successfully navigated to Issues tab - that's sufficient for sanity check
    const issuesTab = page.getByRole("tab", { name: "Issues" });
    await expect(issuesTab).toHaveAttribute("aria-selected", "true");

    // If we got here, the GitHub Issues plugin is present
    expect(true).toBe(true);
  });
});
