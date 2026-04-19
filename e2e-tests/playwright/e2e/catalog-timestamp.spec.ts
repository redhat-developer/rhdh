import { Page, expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import { CatalogImport } from "../support/pages/catalog-import";
import { APIHelper } from "../utils/api-helper";
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
    // Clear search filter from previous test to show all components
    const clearButton = page.getByRole("button", { name: "clear search" });
    if ((await clearButton.isVisible()) && (await clearButton.isEnabled())) {
      await clearButton.click();
    }

    const dataRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") });

    // Wait for the table to have data rows
    await expect(dataRows).not.toHaveCount(0);

    const column = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });

    // Verify the "Created At" column is not yet sorted
    const sortLabel = column.locator("[class*='MuiTableSortLabel-active']");
    await expect(sortLabel).toBeHidden();

    // Click to sort ascending — the sort label should become active
    await column.click();
    await expect(sortLabel).toBeVisible();

    // Click again to sort descending — the sort label should remain active
    await column.click();
    await expect(sortLabel).toBeVisible();

    // Verify the timestamped entity's "Created At" cell still shows its value
    const timestampRow = page
      .getByRole("row")
      .filter({ hasText: "timestamp-test-created" });
    const createdAtCell = timestampRow.getByRole("cell").filter({
      hasText: /\d{1,2}\/\d{1,2}\/\d{4}/,
    });
    await expect(createdAtCell).toBeVisible();
  });

  test.afterAll(async () => {
    // Unregister the imported entity to ensure clean state for retries
    const id = await APIHelper.getLocationIdByTarget(component);
    if (id) {
      await APIHelper.deleteEntityLocationById(id);
    }
    await page.close();
  });
});
