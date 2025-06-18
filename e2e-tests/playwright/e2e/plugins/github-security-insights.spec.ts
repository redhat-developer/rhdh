import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";

if (!process.env.GH_USER_ID || !process.env.GH_USER_PASS || !process.env.GH_2FA_SECRET) {
    throw new Error("GH_USER_ID, GH_USER_PASS, and GH_2FA_SECRET must be set in your environment or .env file.");
}

test("Verify GitHub Security Insights plugin after login", async ({ page, context }) => {
  const repoName = "Backstage Showcase";
  const common = new Common(page);
  const uiHelper = new UIhelper(page);

  await common.loginAsKeycloakUser(process.env.GH_USER_ID, process.env.GH_USER_PASS);
  await uiHelper.openSidebar("Catalog");
  await page.fill('input[placeholder="Search"]', repoName);
  await page.waitForSelector('a:has-text("Backstage Showcase")', { timeout: 20000 });
  await uiHelper.clickLink(repoName);
  await page.waitForLoadState("networkidle");

  await uiHelper.waitForCardWithHeader("Dependabot Alerts");
  await uiHelper.clickBtnInCard('Dependabot Alerts', 'Sign in', true);
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
  await uiHelper.verifyTextinCard('Dependabot Alerts', 'Critical severity');
  await uiHelper.verifyTextinCard('Dependabot Alerts', 'High severity');
  await uiHelper.verifyTextinCard('Dependabot Alerts', 'Medium severity');
  await uiHelper.verifyTextinCard('Dependabot Alerts', 'Low severity');
}); 