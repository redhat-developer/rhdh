import { test, expect } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";

if (!process.env.GH_USER_ID || !process.env.GH_USER_PASS || !process.env.GH_2FA_SECRET) {
    throw new Error("GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.");
}

test("Verify GitHub Security Insights plugin after login", async ({
  page,
  context,
}) => {
  const repoName = "Red Hat Developer Hub";
  const common = new Common(page);
  const uiHelper = new UIhelper(page);

  await common.loginAsKeycloakUser(
    process.env.GH_USER_ID,
    process.env.GH_USER_PASS,
  );
  
  // Wait for the page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  await uiHelper.openSidebar("Catalog");
  await uiHelper.searchInputPlaceholder(repoName);
  await uiHelper.verifyLink(repoName);
  await uiHelper.clickLink(repoName);

  // Wait for the component page to load
  await page.waitForTimeout(2000);

  // Click the specific "Sign in" button in the Dependabot Alerts card
  // Use a more specific approach to avoid ambiguity
  const dependabotCard = page.locator('div[class*="MuiCard-root"]').filter({ hasText: "Dependabot Alerts" }).first();
  await dependabotCard.scrollIntoViewIfNeeded();
  await dependabotCard.getByRole('button', { name: 'Sign in' }).first().click();
  await uiHelper.isBtnVisible("Log in");
  await Promise.all([
    common.githubLoginPopUpModal(
      context,
      process.env.GH_USER_ID,
      process.env.GH_USER_PASS,
      process.env.GH_2FA_SECRET,
    ),
    uiHelper.clickButton("Log in"),
  ]);
  
  // Wait for GitHub login to complete
  await page.waitForTimeout(3000);
  
  // Verify that the Dependabot Alerts card is now showing data (not the "Sign in" message)
  // First, make sure we're not seeing the "Sign in" message anymore
  await expect(page.locator('div[class*="MuiCard-root"]').filter({ hasText: "Dependabot Alerts" })).not.toContainText("You are not logged into GitHub");
  
  // Then verify the severity levels are visible
  const severities = ["Critical severity", "High severity", "Medium severity", "Low severity"];
  
  for (const severity of severities) {
    // Use more flexible text matching
    await expect(page.locator('div[class*="MuiCard-root"]').filter({ hasText: "Dependabot Alerts" })).toContainText(severity, { timeout: 30000 });
    await page.waitForTimeout(500);
  }
});
