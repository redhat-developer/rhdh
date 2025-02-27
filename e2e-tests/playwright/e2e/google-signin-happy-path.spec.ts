import { test, Page } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";

let page: Page;
test.describe.skip("Google signin happy path", () => {
  let uiHelper: UIhelper;
  let common: Common;
  const googleUserId = process.env.GOOGLE_USER_ID;

  test.beforeAll(async ({ browser }) => {
    const cookiesBase64 = process.env.GOOGLE_ACC_COOKIE;
    const cookiesString = Buffer.from(cookiesBase64, "base64").toString("utf8");
    const cookies = JSON.parse(cookiesString);

    const context = await browser.newContext({
      storageState: cookies,
      locale: "en-US",
    });
    page = await context.newPage();

    uiHelper = new UIhelper(page);
    common = new Common(page);

    await common.loginAsGuest();
  });

  test("Verify Google Sign in", async () => {
    await uiHelper.goToSettingsPage();
    await uiHelper.clickTab("Authentication Providers");
    await page.getByTitle("Sign in to Google").click();
    await uiHelper.clickButton("Log in");
    await common.googleSignIn(googleUserId);
    await uiHelper.verifyText(googleUserId, false);
  });

  test.afterAll(async () => {
    await page.close();
  });
});
