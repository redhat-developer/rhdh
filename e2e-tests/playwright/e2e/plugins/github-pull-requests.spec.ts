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

  await common.loginAsKeycloakUser(process.env.GH_USER_ID, process.env.GH_USER_PASS);
  await catalog.goToByName(repoName);
  await uiHelper.isBtnVisible('Sign in');
  await uiHelper.clickButton('Sign in');
  await uiHelper.isBtnVisible('Log in');
  const selector = uiHelper.getButtonSelector('Log in');
  await Promise.all([
    common.githubLoginPopUpModal(
      context,
      process.env.GH_USER_ID,
      process.env.GH_USER_PASS,
      process.env.GH_2FA_SECRET
    ),
    uiHelper.clickButton('Log in'),
  ]);
  await uiHelper.verifyTextinCard('GitHub Pull Requests Statistics', 'Average Time Of PR Until Merge');
  const stats = [
    "Average Time Of PR Until Merge",
    "Merged To Closed Ratio",
    "Average Size Of PR",
    "Average Changed Files Of PR",
    "Average Coding Time Of PR"
  ];
  for (const stat of stats) {
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", stat);
    await page.waitForTimeout(500);
  }
});

