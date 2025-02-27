import { test } from "@playwright/test";
import { UiHelper } from "../../utils/ui-helper";
import { Common, setupBrowser } from "../../utils/common";

let page;
test.describe("Test ACR plugin", () => {
  let uiHelper: UiHelper;
  let common: Common;
  const dateRegex =
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}/gm;
  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UiHelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify ACR Images are visible", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.verifyHeading("My Org Catalog");
    await uiHelper.selectMuiBox("Kind", "component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink("acr-test-entity");
    await uiHelper.clickTab("Image Registry");
    await uiHelper.verifyHeading(
      "Azure Container Registry Repository: hello-world",
    );
    await uiHelper.verifyRowInTableByUniqueText("latest", [dateRegex]);
    await uiHelper.verifyRowInTableByUniqueText("v1", [dateRegex]);
    await uiHelper.verifyRowsInTable(["v2", "v3"]);
  });
});
