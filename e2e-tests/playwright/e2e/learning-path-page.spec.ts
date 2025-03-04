import { expect, test } from "@playwright/test";
import { UiHelper } from "../utils/ui-helper";
import { Common } from "../utils/common";

test.describe("Learning Paths", () => {
  let common: Common;
  let uiHelper: UiHelper;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UiHelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify that links in Learning Paths for Backstage opens in a new tab", async ({
    page,
  }) => {
    await uiHelper.openSidebarButton("References");
    await uiHelper.openSidebar("Learning Paths");

    for (let i = 0; i < 5; i++) {
      const learningPathCard = page
        .locator(`div[class*="MuiGrid-item"]>a[target="_blank"]`)
        .nth(i);
      await expect(learningPathCard).toBeVisible();
      expect(await learningPathCard.getAttribute("href")).not.toBe("");
    }
  });
});
