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

  await uiHelper.clickBtnInCard("Dependabot Alerts", "Sign in", true);
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
  
  await uiHelper.verifyTextinCard("Dependabot Alerts", "Critical severity");
  await uiHelper.verifyTextinCard("Dependabot Alerts", "High severity");
  await uiHelper.verifyTextinCard("Dependabot Alerts", "Medium severity");
  await uiHelper.verifyTextinCard("Dependabot Alerts", "Low severity");
});
