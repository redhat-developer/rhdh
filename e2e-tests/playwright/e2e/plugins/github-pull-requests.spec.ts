import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";
import { CatalogHelper } from "../../utils/catalog-helper";

if (!process.env.GH_USER_ID || !process.env.GH_USER_PASS || !process.env.GH_2FA_SECRET) {
    throw new Error("GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.");
}

test("Verify all GitHub Pull Requests statistics after login", async ({ page, context }) => {
  const repoName = "Backstage Showcase";
  const common = new Common(page);
  const uiHelper = new UIhelper(page);
  const catalog = new CatalogHelper(page);

  // Step 1: Login to RHDH
  await common.loginAsKeycloakUser(process.env.GH_USER_ID, process.env.GH_USER_PASS);
  
  // Step 2: Navigate to component in catalog
  await catalog.goToByName(repoName);

  // Step 3: Wait for PR statistics card
  await uiHelper.waitForCardWithHeader("GitHub Pull Requests Statistics");
  
  // Step 4: Click 'Sign in' inside the PR statistics card
  await uiHelper.clickBtnInCard('GitHub Pull Requests Statistics', 'Sign in', true);
  
  // Step 5: Handle GitHub login using UIhelper methods
  await uiHelper.isBtnVisible('Log in');
  const selector = uiHelper.getButtonSelector('Log in');
  const modalLoginButton = page.locator(selector);
  await Promise.all([
    common.githubLoginPopUpModal(
      context,
      process.env.GH_USER_ID,
      process.env.GH_USER_PASS,
      process.env.GH_2FA_SECRET
    ),
    modalLoginButton.click(),
  ]);

  // Step 6: Verify statistics
  await uiHelper.verifyTextinCard('GitHub Pull Requests Statistics', 'Average Time Of PR Until Merge');

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

