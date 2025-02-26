import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";

test.describe("Custom Global Header", () => {
  let common: Common;
  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
    await expect(page.locator("nav[id='global-header']")).toBeVisible();
  });

  test("Verify that extra header icon button in global header is visible", async () => {
    await uiHelper.verifyLink({ label: "RHDH repository" });
  });
});
