import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";

if (!process.env.GH_USER_ID || !process.env.GH_USER_PASS || !process.env.GH_2FA_SECRET) {
    throw new Error("GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.");
}

test("Verify Compliance plugin sign in with GitHub", async ({ page, context }) => {
  const repoName = "Backstage Showcase";
  const common = new Common(page);
  const uiHelper = new UIhelper(page);

  // Step 1: Login to RHDH
  await common.loginAsKeycloakUser(process.env.GH_USER_ID, process.env.GH_USER_PASS);
  // Step 2: Navigate to Catalog
  await uiHelper.openSidebar("Catalog");
  // Step 3: Search and click 'Backstage Showcase'
  await page.fill('input[placeholder="Search"]', repoName);
  await page.waitForSelector('a:has-text("Backstage Showcase")', { timeout: 20000 });
  await uiHelper.clickLink(repoName);
  await page.waitForLoadState("networkidle");

  // Step 4: Wait for Compliance card
  await uiHelper.waitForCardWithHeader("Compliance");
  // Step 5: Click 'Sign in' inside the Compliance card
  await uiHelper.clickBtnInCard('Compliance', 'Sign in', true);
  // Wait for the login modal to appear
  const modalLoginButton = page.locator('button:has-text("Log in")');
  await modalLoginButton.waitFor({ timeout: 5000 });
  await Promise.all([
    common.githubLoginPopUpModal(
      context,
      process.env.GH_USER_ID,
      process.env.GH_USER_PASS,
      process.env.GH_2FA_SECRET
    ),
    modalLoginButton.click(),
  ]);
  // Wait for compliance-related content to appear before verifying all
  await uiHelper.verifyTextinCard('Compliance report', 'Protected Branches');
  await uiHelper.verifyTextinCard('Compliance report', 'License');
}); 