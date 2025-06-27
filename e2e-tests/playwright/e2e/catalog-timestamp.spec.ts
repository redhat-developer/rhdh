import { Page, expect } from "@playwright/test";
import { CatalogImport } from "../support/pages/catalog-import";
import { UI_HELPER_ELEMENTS } from "../support/pageObjects/global-obj";
import { guestTest } from "../support/fixtures/guest-login";
import { setupBrowser } from "../utils/common";

let page: Page;
guestTest.describe("Test timestamp column on Catalog", () => {
  guestTest.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env

  const component =
    "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";

  guestTest.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
  });

  guestTest.beforeEach(async ({ uiHelper }) => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.verifyHeading("My Org Catalog");
    await uiHelper.openCatalogSidebar("Component");
  });

  guestTest(
    "Register an existing component and verify `Created At` column and value in the Catalog Page",
    async ({ uiHelper }) => {
      await uiHelper.clickButton("Self-service");
      await uiHelper.clickButton("Register Existing Component");
      await new CatalogImport(page).registerExistingComponent(component);
      await uiHelper.openCatalogSidebar("Component");
      await uiHelper.searchInputPlaceholder("timestamp-test-created");
      await uiHelper.verifyText("timestamp-test-created");
      await uiHelper.verifyColumnHeading(["Created At"], true);
      await uiHelper.verifyRowInTableByUniqueText("timestamp-test-created", [
        /^\d{1,2}\/\d{1,2}\/\d{1,4}, \d:\d{1,2}:\d{1,2} (AM|PM)$/g,
      ]);
    },
  );

  guestTest(
    "Toggle ‘CREATED AT’ to see if the component list can be sorted in ascending/decending order",
    async () => {
      const createdAtFirstRow =
        "table > tbody > tr:nth-child(1) > td:nth-child(8)";
      //Verify by default Rows are in ascending
      await expect(page.locator(createdAtFirstRow)).toBeEmpty();

      const column = page
        .locator(`${UI_HELPER_ELEMENTS.MuiTableHead}`)
        .getByText("Created At", { exact: true });
      await column.dblclick(); // Double click to Toggle into decending order.
      await expect(page.locator(createdAtFirstRow)).not.toBeEmpty();
    },
  );

  guestTest.afterAll(async () => {
    await page.close();
  });
});
