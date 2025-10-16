import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { FabPo } from "../../support/page-objects/global-fab-po";
import { UIhelper } from "../../utils/ui-helper";
import { PagesUrl } from "../../support/page-objects/page";

test.describe("Test global floating action button plugin", () => {
  let uiHelper: UIhelper;
  let fabHelper: FabPo;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();

    uiHelper = new UIhelper(page);
    fabHelper = new FabPo(page, "/" as PagesUrl);
  });

  test("Check if Git and Bulk import floating buttons are visible on the Home page", async () => {
    await uiHelper.openSidebar("Home");
    await fabHelper.verifyFabButtonByLabel("Git");
    await fabHelper.verifyFabButtonByDataTestId("bulk-import");
    await fabHelper.clickFabMenuByTestId("bulk-import");
    await uiHelper.verifyText("Imported entities");
  });

  test("Check if floating button is shown with two sub-menu actions on the Catalog Page, verify Git sub-menu", async () => {
    await uiHelper.openSidebar("Catalog");
    await fabHelper.verifyFabButtonByDataTestId("floating-button-with-submenu");
    await fabHelper.clickFabMenuByTestId("floating-button-with-submenu");
    await fabHelper.verifyFabButtonByLabel("Git");
    await fabHelper.verifyFabButtonByLabel("Quay");
    await fabHelper.clickFabMenuByLabel("Git");
    await fabHelper.verifyPopup("github.com/redhat-developer/rhdh");
  });

  test("Check if floating button is shown with two sub-menu actions on the Catalog Page, verify Quay sub-menu", async () => {
    await uiHelper.openSidebar("Catalog");
    await fabHelper.verifyFabButtonByDataTestId("floating-button-with-submenu");
    await fabHelper.clickFabMenuByTestId("floating-button-with-submenu");
    await fabHelper.verifyFabButtonByLabel("Git");
    await fabHelper.verifyFabButtonByLabel("Quay");
    await fabHelper.clickFabMenuByLabel("Quay");
    await fabHelper.verifyPopup("quay.io");
  });
});
