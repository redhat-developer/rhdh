import { test, expect } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";
import { CatalogHelper } from "../../utils/catalog-helper";

if (!process.env.GH_USER_ID || !process.env.GH_USER_PASS || !process.env.GH_2FA_SECRET) {
    throw new Error("GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.");
}

test("Verify all GitHub Pull Requests statistics after login", async ({
  page,
  context,
}) => {
  const repoName = "Red Hat Developer Hub";
  const common = new Common(page);
  const uiHelper = new UIhelper(page);
  const catalog = new CatalogHelper(page);

  await common.loginAsKeycloakUser(
    process.env.GH_USER_ID,
    process.env.GH_USER_PASS,
  );
  
  // Wait for the page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  await catalog.goToByName(repoName);
  
  // Wait for the component page to load
  await page.waitForTimeout(2000);
  
  // Click the specific "Sign in" button in the GitHub Pull Requests Statistics card
  await uiHelper.clickBtnInCard("GitHub Pull Requests Statistics", "Sign in", true);
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
  
  // Wait for the GitHub PR statistics to load after login
  await page.waitForTimeout(5000);
  
  // Verify that the GitHub PR statistics card is now showing data (not the "Sign in" message)
  await uiHelper.verifyTextinCard(
    "GitHub Pull Requests Statistics",
    "Average Time Of PR Until Merge",
    true,
    30000,
  );
  
  const stats = [
    "Average Time Of PR Until Merge",
    "Merged To Closed Ratio", 
    "Average Size Of PR",
    "Average Changed Files Of PR",
    "Average Coding Time Of PR",
  ];
  
  for (const stat of stats) {
    await uiHelper.verifyTextinCard(
      "GitHub Pull Requests Statistics",
      stat,
      true,
      30000,
    );
    await page.waitForTimeout(500);
  }
});
