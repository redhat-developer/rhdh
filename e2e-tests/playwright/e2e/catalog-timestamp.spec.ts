import { Page, expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import { CatalogImport } from "../support/pages/catalog-import";
import { UI_HELPER_ELEMENTS } from "../support/page-objects/global-obj";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let page: Page;
test.describe("Test timestamp column on Catalog", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env

  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;

  const component =
    "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    page = (await setupBrowser(browser, testInfo)).page;

    common = new Common(page);
    uiHelper = new UIhelper(page);
    catalogImport = new CatalogImport(page);

    await common.loginAsGuest();
  });

  test.beforeEach(async () => {
    await uiHelper.openSidebar(t["rhdh"][lang]["menuItem.catalog"]);
    await uiHelper.verifyHeading(
      t["catalog"][lang]["indexPage.title"].replace("{{orgName}}", "My Org"),
    );
    await uiHelper.openCatalogSidebar("Component");
  });

  test("Import an existing Git repository and verify `Created At` column and value in the Catalog Page", async () => {
    await uiHelper.clickButton(t["rhdh"][lang]["menuItem.selfService"]);
    await uiHelper.clickButton(
      t["catalog-import-test"][lang]["buttons.importExistingGitRepository"],
    );
    await catalogImport.registerExistingComponent(component);
    await uiHelper.openCatalogSidebar("Component");
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
