import { Page, expect, test } from "@playwright/test";
import { UiHelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import { CatalogImport } from "../support/pages/catalog-import";
import { UI_HELPER_ELEMENTS } from "../support/pageObjects/global-obj";

let page: Page;
test.describe("Test timestamp column on Catalog", () => {
  let uiHelper: UiHelper;
  let common: Common;
  let catalogImport: CatalogImport;

  const component =
    "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    common = new Common(page);
    uiHelper = new UiHelper(page);
    catalogImport = new CatalogImport(page);

    await common.loginAsGuest();
  });

  test.beforeEach(async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.verifyHeading("My Org Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
  });

  test("Register an existing component and verify `Created At` column and value in the Catalog Page", async () => {
    await uiHelper.clickButton("Create");
    await uiHelper.clickButton("Register Existing Component");
    await catalogImport.registerExistingComponent(component);
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.searchInputPlaceholder("timestamp-test-created");
    await uiHelper.verifyText("timestamp-test-created");
    await uiHelper.verifyColumnHeading(["Created At"], true);
    await uiHelper.verifyRowInTableByUniqueText("timestamp-test-created", [
      /^\d{1,2}\/\d{1,2}\/\d{1,4}, \d:\d{1,2}:\d{1,2} (AM|PM)$/g,
    ]);
  });

  test("Toggle ‘CREATED AT’ to see if the component list can be sorted in ascending/decending order", async () => {
    const createdAtFirstRow =
      "table > tbody > tr:nth-child(1) > td:nth-child(8)";
    //Verify by default Rows are in ascending
    await expect(page.locator(createdAtFirstRow)).toBeEmpty();

    const column = page
      .locator(`${UI_HELPER_ELEMENTS.MuiTableHead}`)
      .getByText("Created At", { exact: true });
    await column.dblclick(); // Double click to Toggle into decending order.
    await expect(page.locator(createdAtFirstRow)).not.toBeEmpty();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
