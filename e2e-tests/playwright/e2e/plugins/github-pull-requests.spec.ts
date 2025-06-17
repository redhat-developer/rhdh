import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";
import { authenticator } from "otplib";

if (!process.env.GH_USER_ID || !process.env.GH_USER_PASS || !process.env.GH_2FA_SECRET) {
    throw new Error("GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.");
  }

test("Verify all GitHub Pull Requests statistics after login", async ({ page, context }) => {
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

  // Step 4: Wait for PR statistics card
  await uiHelper.waitForCardWithHeader("GitHub Pull Requests Statistics");
  // Step 5: Click 'Sign in' inside the PR statistics card
  await uiHelper.clickBtnInCard('GitHub Pull Requests Statistics', 'Sign in', true);
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
  // Wait for at least one stat to appear before verifying all
  await uiHelper.verifyTextinCard('GitHub Pull Requests Statistics', 'Average Time Of PR Until Merge');
  // Step 6: Log any error popups
  const errorPopup = page.locator('.MuiSnackbar-root, [role="alert"], .alert');
  if (await errorPopup.isVisible({ timeout: 2000 }).catch(() => false)) {
    const errorText = await errorPopup.textContent();
  }
  // Wait for all statistics to appear in the card
  const stats = [
    "Average Time Of PR Until Merge",
    "Merged To Closed Ratio",
    "Average Size Of PR",
    "Average Changed Files Of PR",
    "Average Coding Time Of PR"
  ];
  for (const stat of stats) {
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", stat);
    await page.waitForTimeout(500); // Small buffer between checks
  }
});

