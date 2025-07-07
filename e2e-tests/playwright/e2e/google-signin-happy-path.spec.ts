import test from "@playwright/test";

import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";

test.describe.skip("Google signin happy path", () => {
  const googleUserId = process.env.GOOGLE_USER_ID;

  test("Verify Google Sign in", async ({ browser, page }) => {
    const cookiesBase64 = process.env.GOOGLE_ACC_COOKIE;
    const cookiesString = Buffer.from(cookiesBase64, "base64").toString("utf8");
    const cookies = JSON.parse(cookiesString);

    const context = await browser.newContext({
      storageState: cookies,
      locale: "en-US",
    });
    page = await context.newPage();

    const uiHelper = new UIhelper(page);
    const common = new Common(page);

    await common.loginAsGuest();

    await uiHelper.goToSettingsPage();
    await uiHelper.clickTab("Authentication Providers");
    await page.getByTitle("Sign in to Google").click();
    await uiHelper.clickButton("Log in");
    await common.googleSignIn(googleUserId);
    await uiHelper.verifyText(googleUserId, false);
  });
});
