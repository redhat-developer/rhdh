import { test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";

test.describe("TechDocs", () => {
  let common: Common;
  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify that TechDocs is visible in sidebar", async () => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
  });

  test("Verify that TechDocs for RHDH works", async ({ page }) => {
    await uiHelper.openSidebarButton("Favorites");
    await uiHelper.openSidebar("Docs");
    await page.getByRole("link", { name: "Red Hat Developer Hub" }).click();
  });
});
