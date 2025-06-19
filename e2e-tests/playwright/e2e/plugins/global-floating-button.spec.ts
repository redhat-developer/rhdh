import { FabPo } from "../../support/pageObjects/global-fab-po";
import { PagesUrl } from "../../support/pageObjects/page";
import { guestTest } from "../../support/fixtures/guest-login";

guestTest.describe("Test global floating action button plugin", () => {
  let fabHelper: FabPo;

  guestTest.beforeEach(async ({ page }) => {
    fabHelper = new FabPo(page, "/" as PagesUrl);
  });

  guestTest(
    "Check if Git and Bulk import floating buttons are visible on the Home page",
    async ({ uiHelper }) => {
      await uiHelper.openSidebar("Home");
      await fabHelper.verifyFabButtonByLabel("Git");
      await fabHelper.verifyFabButtonByDataTestId("bulk-import");
      await fabHelper.clickFabMenuByTestId("bulk-import");
      await uiHelper.verifyText("Added repositories");
    },
  );

  guestTest(
    "Check if floating button is shown with two sub-menu actions on the Catalog Page, verify Git sub-menu",
    async ({ uiHelper }) => {
      await uiHelper.openSidebar("Catalog");
      await fabHelper.verifyFabButtonByDataTestId(
        "floating-button-with-submenu",
      );
      await fabHelper.clickFabMenuByTestId("floating-button-with-submenu");
      await fabHelper.verifyFabButtonByLabel("Git");
      await fabHelper.verifyFabButtonByLabel("Quay");
      await fabHelper.clickFabMenuByLabel("Git");
      await fabHelper.verifyPopup("github.com/redhat-developer/rhdh");
    },
  );

  guestTest(
    "Check if floating button is shown with two sub-menu actions on the Catalog Page, verify Quay sub-menu",
    async ({ uiHelper }) => {
      await uiHelper.openSidebar("Catalog");
      await fabHelper.verifyFabButtonByDataTestId(
        "floating-button-with-submenu",
      );
      await fabHelper.clickFabMenuByTestId("floating-button-with-submenu");
      await fabHelper.verifyFabButtonByLabel("Git");
      await fabHelper.verifyFabButtonByLabel("Quay");
      await fabHelper.clickFabMenuByLabel("Quay");
      await fabHelper.verifyPopup("quay.io");
    },
  );
});
