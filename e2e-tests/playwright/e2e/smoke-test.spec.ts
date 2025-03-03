import { test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { HomePage } from "../support/pages/home-page";
import { Common } from "../utils/common";

test.describe("Smoke test", () => {
  let uiHelper: UIhelper;
  let homePage: HomePage;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    homePage = new HomePage(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify the Homepage renders with Search Bar, Quick Access and Starred Entities", async () => {
    await uiHelper.verifyHeading("Welcome back!");
    await uiHelper.openSidebar("Home");
    await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
  });
});
