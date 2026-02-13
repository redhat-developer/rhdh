import { Page, expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import { CatalogImport } from "../support/pages/catalog-import";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let page: Page;

test.describe("Test timestamp column on Catalog", () => {
  test.skip(
    () => process.env.JOB_NAME.includes("osd-gcp"),
    "skipping on OSD-GCP cluster due to RHDHBUGS-555",
  );

  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;

  const component =
    "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";

  test.beforeAll(async ({ browser }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    page = (await setupBrowser(browser)).page;

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
    await uiHelper.goToSelfServicePage();
    await uiHelper.clickButton(
      t["scaffolder"][lang][
        "templateListPage.contentHeader.registerExistingButtonTitle"
      ],
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

  test("Toggle 'CREATED AT' to see if the component list can be sorted in ascending/decending order", async () => {
    // Get the first data row's "Created At" cell using semantic selectors
    const firstRow = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") })
      .first();
    const createdAtCell = firstRow.getByRole("cell").nth(7); // 0-indexed, 8th column = index 7

    //Verify by default Rows are in ascending (empty for oldest entries)
    await expect(createdAtCell).toBeEmpty();

    // Use semantic selector for column header instead of MUI class
    const column = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });
    await column.dblclick(); // Double click to Toggle into descending order.
    await expect(createdAtCell).not.toBeEmpty();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
