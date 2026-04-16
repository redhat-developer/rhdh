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
    // Search for the known entity with a "Created At" value to isolate it
    await uiHelper.searchInputPlaceholder("timestamp-test-created");
    await uiHelper.verifyText("timestamp-test-created");

    // Locate the row containing the timestamped entity and its "Created At" cell
    const timestampRow = page
      .getByRole("row")
      .filter({ hasText: "timestamp-test-created" });
    const createdAtCell = timestampRow.getByRole("cell").filter({
      hasText: /\d{1,2}\/\d{1,2}\/\d{4}/,
    });

    // Verify the "Created At" cell has a date value before sorting
    await expect(createdAtCell).toBeVisible();
    const valueBefore = await createdAtCell.textContent();

    const column = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });

    // Sort ascending — the cell value should be preserved
    await column.click();
    await expect(createdAtCell).toHaveText(valueBefore);

    // Sort descending — the cell value should still be preserved
    await column.click();
    await expect(createdAtCell).toHaveText(valueBefore);
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
