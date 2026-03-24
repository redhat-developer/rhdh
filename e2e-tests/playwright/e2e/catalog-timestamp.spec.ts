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
    await uiHelper.goToSelfServicePage();
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

  test("Toggle 'CREATED AT' to see if the component list can be sorted in ascending/decending order", async () => {
    // Clear search filter from previous test to show all components
    const clearButton = page.getByRole("button", { name: "clear search" });
    if (await clearButton.isVisible()) {
      await clearButton.click();
    }

    // Wait for the table to have data rows
    await expect(
      page.getByRole("row").filter({ has: page.getByRole("cell") }),
    ).not.toHaveCount(0);

    // Get the first data row's "Created At" cell using semantic selectors
    const firstRow = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") })
      .first();
    const createdAtCell = firstRow.getByRole("cell").nth(7); // 0-indexed, 8th column = index 7

    const column = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });

    // Click twice to sort descending — newest entries first
    await column.click();
    await column.click();

    // After sorting descending, the first row should have a non-empty "Created At"
    await expect(createdAtCell).not.toBeEmpty();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
