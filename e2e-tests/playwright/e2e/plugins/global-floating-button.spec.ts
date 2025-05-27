import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { FabPo } from "../../support/pageObjects/global-fab-po";
import { UIhelper } from "../../utils/ui-helper";
import { PagesUrl } from "../../support/pageObjects/page";

test.describe("Test global floating action button plugin", () => {
  // TODO: fix https://issues.redhat.com/browse/RHIDP-6492 and remove the skip
  test.skip(() => process.env.JOB_NAME.includes("operator"));

  let uiHelper: UIhelper;
  let fabHelper: FabPo;

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
    await fabHelper.clickFabMenuByLabel("Git");
    await uiHelper.verifyText("Added repositories");
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
