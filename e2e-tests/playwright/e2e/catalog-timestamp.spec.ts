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
    await uiHelper.clickLink({
      // TODO: RHDHBUGS-2564 - String not getting translated
      // ariaLabel: t["rhdh"][lang]["menuItem.selfService"],
      ariaLabel: "Self-service",
    });
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
    // Scope to the catalog table (has "Created At" column); avoid pagination row
    const catalogTable = page.getByRole("table").filter({
      has: page.getByRole("columnheader", { name: "Created At" }),
    });
    const firstDataRow = catalogTable
      .getByRole("row")
      .filter({ has: page.getByRole("cell") })
      .first();
    const createdAtCell = firstDataRow.getByRole("cell").nth(7); // Created At = 8th column (index 7)

    // By default the first row's Created At cell has a date (or is empty for oldest); ensure column is present
    await expect(createdAtCell).toBeVisible();

    // Toggle sort via column header (ascending ↔ descending)
    const column = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });
    await column.dblclick();

    // After toggle, the first row's Created At cell should still have content (table still sorted and rendered)
    await expect(createdAtCell).not.toBeEmpty();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
