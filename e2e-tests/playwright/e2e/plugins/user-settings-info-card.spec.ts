import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { UI_HELPER_ELEMENTS } from "../../support/page-objects/global-obj";

test.describe("Test user settings info card", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();

    uiHelper = new UIhelper(page);
  });

  test("Check if customized build info is rendered", async ({ page }) => {
    await uiHelper.openSidebar("Home");
    await page.getByText("Guest").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await uiHelper.verifyTextInSelector(
      UI_HELPER_ELEMENTS.MuiCardHeader,
      "RHDH Build info",
    );
    await uiHelper.verifyTextInSelector(
      UI_HELPER_ELEMENTS.MuiCard("RHDH Build info"),
      "TechDocs builder: local\nAuthentication provider: Github",
    );
    await page.getByTitle("Show more").click();
    await uiHelper.verifyTextInSelector(
      UI_HELPER_ELEMENTS.MuiCard("RHDH Build info"),
      "TechDocs builder: local\nAuthentication provider: Github\nRBAC: disabled",
    );
  });
});
