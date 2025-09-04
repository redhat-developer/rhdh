import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Learning Paths", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  let common: Common;
  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify that links in Learning Paths for Backstage opens in a new tab", async ({
    page,
  }, testInfo) => {
    await uiHelper.openSidebarButton("References");
    await uiHelper.openSidebar("Learning Paths");

    for (let i = 0; i < 5; i++) {
      const learningPathCard = page
        .locator(`div[class*="MuiGrid-item"]>a[target="_blank"]`)
        .nth(i);
      await expect(learningPathCard).toBeVisible();
      await expect(learningPathCard).not.toHaveAttribute("href", "");
    }

    await runAccessibilityTests(page, testInfo);
  });
});
