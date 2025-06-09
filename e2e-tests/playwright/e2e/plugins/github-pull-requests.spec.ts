import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";
import { authenticator } from "otplib";

// Credentials and 2FA secret should be set in your environment or .env file:
// GH_USER_ID=rhdh-qe-2
// GH_USER_PASS=rhdh-qe-2@123
// GH_USER2_2FA_SECRET=2FECZIO5POVHP2VV
const GITHUB_USERNAME = process.env.GH_USER_ID || "rhdh-qe-2";
const GITHUB_PASSWORD = process.env.GH_USER_PASS || "rhdh-qe-2@123";

async function githubLogin(context, username, password) {
  const [githubPage] = await Promise.all([
    context.waitForEvent('page'),
  ]);
  await githubPage.waitForLoadState();
  await githubPage.waitForSelector('input[name="login"]', { timeout: 30000 });
  await githubPage.fill('input[name="login"]', username);
  await githubPage.fill('input[name="password"]', password);
  await githubPage.click('button[type="submit"], input[type="submit"]');

  // Handle 2FA with up to 5 attempts
  let otpSelector = null;
  if (await githubPage.isVisible('input[name="otp"]', { timeout: 10000 }).catch(() => false)) {
    otpSelector = 'input[name="otp"]';
  } else if (await githubPage.isVisible('#app_totp', { timeout: 10000 }).catch(() => false)) {
    otpSelector = '#app_totp';
  }
  if (otpSelector) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (githubPage.isClosed()) {
        console.log('[DEBUG] Popup closed before TOTP could be entered.');
        break;
      }
      try {
        await githubPage.waitForSelector(otpSelector, { timeout: 10000 });
      } catch (e) {
        if (githubPage.isClosed()) {
          console.log('[DEBUG] Popup closed while waiting for selector.');
          break;
        }
        throw e;
      }
      if (githubPage.isClosed()) {
        console.log('[DEBUG] Popup closed after waiting for selector.');
        break;
      }
      const otpSecret = process.env.GH_USER2_2FA_SECRET;
      if (!otpSecret) throw new Error("2FA is enabled but GH_USER2_2FA_SECRET is not set.");
      const otp = authenticator.generate(otpSecret);
      console.log(`[DEBUG] [2FA Attempt ${attempt}] Generated TOTP code: ${otp} for selector: ${otpSelector} at ${new Date().toISOString()}`);
      await githubPage.fill(otpSelector, otp);
      if (githubPage.isClosed()) {
        console.log('[DEBUG] Popup closed after filling TOTP.');
        break;
      }
      // Submit and wait for popup to close in parallel
      const result = await Promise.race([
        Promise.all([
          githubPage.waitForEvent('close', { timeout: 20000 }).then(() => 'closed'),
          githubPage.click('button[type="submit"], input[type="submit"]'),
        ]).then(() => 'closed').catch(() => null),
        githubPage.waitForSelector('div[role="alert"], .flash-error', { timeout: 10000 }).then(() => 'error').catch(() => null)
      ]);
      if (githubPage.isClosed()) {
        console.log('[DEBUG] Popup closed after submit.');
        break;
      }
      if (result === 'closed') {
        console.log(`[DEBUG] [2FA Attempt ${attempt}] Popup closed after TOTP.`);
        break;
      } else if (result === 'error') {
        console.log(`[DEBUG] [2FA Attempt ${attempt}] TOTP code rejected, retrying if possible.`);
        if (attempt === 5) throw new Error('2FA failed after 5 attempts');
        await githubPage.fill(otpSelector, ''); // Clear field before retry
        await githubPage.waitForTimeout(1000); // Wait a second before retry
      }
    }
    console.log(`[DEBUG] Submitted TOTP code.`);
  } else {
    console.log('[DEBUG] No 2FA prompt detected.');
    await githubPage.waitForEvent('close', { timeout: 20000 });
  }
  console.log('[DEBUG] GitHub login popup closed.');
}

test("Verify all GitHub Pull Requests statistics after login", async ({ page, context }) => {
  const repoName = "Backstage Showcase";
  const common = new Common(page);
  const uiHelper = new UIhelper(page);

  // Step 1: Login to RHDH
  await common.loginAsKeycloakUser(GITHUB_USERNAME, GITHUB_PASSWORD);
  // Step 2: Navigate to Catalog
  await uiHelper.openSidebar("Catalog");
  // Step 3: Search and click 'Backstage Showcase'
  await page.fill('input[placeholder="Search"]', repoName);
  await page.waitForTimeout(1000);
  await uiHelper.clickLink(repoName);
  await page.waitForLoadState("networkidle");
  console.log('[DEBUG] Navigated to Backstage Showcase entity page.');

  // Step 4: Wait for PR statistics card
  await uiHelper.waitForCardWithHeader("GitHub Pull Requests Statistics");
  // Step 5: Click 'Sign in' if visible
  const signInButton = page.locator('text=Sign in');
  if (await signInButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[DEBUG] Sign in button is visible, starting GitHub login flow.');
    await signInButton.click();
    const modalLoginButton = page.locator('button:has-text("Log in")');
    await modalLoginButton.waitFor({ timeout: 5000 });
    await Promise.all([
      githubLogin(context, GITHUB_USERNAME, GITHUB_PASSWORD),
      modalLoginButton.click(),
    ]);
    console.log('[DEBUG] Completed GitHub login and 2FA. Waiting for all statistics to load...');
    // Step 6: Log any error popups
    const errorPopup = page.locator('.MuiSnackbar-root, [role="alert"], .alert');
    if (await errorPopup.isVisible({ timeout: 2000 }).catch(() => false)) {
      const errorText = await errorPopup.textContent();
      console.log(`[DEBUG] Error popup after login: ${errorText}`);
    }
    // Wait for all statistics to appear in the card (robust, no manual pause)
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
    console.log('[DEBUG] All statistics verified as visible.');
  }
  // Step 7: Wait for PR statistics to be visible after login
  await uiHelper.waitForCardWithHeader("GitHub Pull Requests Statistics");
  await page.waitForTimeout(3000); // Give extra time for statistics to load
  // Step 8: Debug: print the card's text content
  const card = page.locator('//div[contains(@class,"MuiCardHeader-root") and descendant::*[text()="GitHub Pull Requests Statistics"]]/..');
  const cardText = await card.textContent().catch(() => '[DEBUG] Could not get card text');
  console.log(`[DEBUG] Card text after login: ${cardText}`);
  // Step 9: Assert all statistics, with a wait between each
  const stats = [
    "Average Time Of PR Until Merge",
    "Merged To Closed Ratio",
    "Average Size Of PR",
    "Average Changed Files Of PR",
    "Average Coding Time Of PR"
  ];
  for (const stat of stats) {
    await page.waitForTimeout(1500); // Wait 1.5s between checks
    await uiHelper.verifyTextinCard("GitHub Pull Requests Statistics", stat);
  }
}); 