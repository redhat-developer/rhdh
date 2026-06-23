import { Page, expect, test } from "@support/coverage/test";
import { Common } from "../utils/common";
import { CatalogImport } from "../support/pages/catalog-import";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";
import { CatalogBrowsePage } from "../support/pages/catalog-browse-page";
import { SelfServicePage } from "../support/pages/self-service-page";
import {
  createManagedBrowserSession,
  type ManagedBrowserSession,
} from "../support/fixtures/managed-browser";

const t = getTranslations();
const lang = getCurrentLanguage();

let page: Page;
let browserSession: ManagedBrowserSession;

test.describe("Test timestamp column on Catalog", () => {
  test.skip(
    () => (process.env.JOB_NAME ?? "").includes("osd-gcp"),
    "skipping on OSD-GCP cluster due to RHDHBUGS-555",
  );

  let catalogBrowsePage: CatalogBrowsePage;
  let selfServicePage: SelfServicePage;
  let common: Common;
  let catalogImport: CatalogImport;

  const component =
    "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    browserSession = await createManagedBrowserSession(browser, testInfo);
    page = browserSession.page;

    common = new Common(page);
    catalogBrowsePage = new CatalogBrowsePage(page);
    selfServicePage = new SelfServicePage(page);
    catalogImport = new CatalogImport(page);

    await common.loginAsGuest();
  });

  test.beforeEach(async () => {
    await catalogBrowsePage.openSidebar(t["rhdh"][lang]["menuItem.catalog"]);
    await catalogBrowsePage.verifyHeading(
      t["catalog"][lang]["indexPage.title"].replace("{{orgName}}", "My Org"),
    );
    await catalogBrowsePage.openCatalogSidebar("Component");
  });

  test("Import an existing Git repository and verify `Created At` column and value in the Catalog Page", async () => {
    await selfServicePage.open();
    await selfServicePage.clickImportGitRepositoryLocalized(
      t["scaffolder"][lang][
        "templateListPage.contentHeader.registerExistingButtonTitle"
      ],
    );
    await catalogImport.registerExistingComponent(component);
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.searchCatalog("timestamp-test-created");
    await catalogBrowsePage.verifyText("timestamp-test-created");
    await catalogBrowsePage.verifyColumnHeading(["Created At"], true);
    await catalogBrowsePage.verifyRowByUniqueText("timestamp-test-created", [
      /^\d{1,2}\/\d{1,2}\/\d{1,4}, \d:\d{1,2}:\d{1,2} (AM|PM)$/u,
    ]);
  });

  test("Toggle 'CREATED AT' to see if the component list can be sorted in ascending/decending order", async () => {
    // Clear search filter from previous test to show all components
    const clearButton = page.getByRole("button", { name: "clear search" });
    if ((await clearButton.isVisible()) && (await clearButton.isEnabled())) {
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
    const createdAtCell = firstRow.getByRole("cell").nth(7);

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
    await browserSession.dispose();
  });
});
