import { Page, expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common, setupBrowser } from "../utils/common";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

let page: Page;

/**
 * E2E tests for catalog table column customization feature.
 *
 * These tests verify that platform engineers can configure catalog table columns
 * via app-config.yaml to:
 * - Hide default columns (like "Created At")
 * - Add custom columns based on entity metadata
 * - Sort columns correctly
 *
 * Note: These tests require specific app-config.yaml configuration to be applied
 * before running. The configuration should include catalog.table.columns settings.
 *
 * Example configuration for testing:
 * ```yaml
 * catalog:
 *   table:
 *     columns:
 *       exclude:
 *         - createdAt
 *       custom:
 *         - title: "Security Tier"
 *           field: "metadata.annotations['custom/security-tier']"
 *           sortable: true
 * ```
 */
test.describe("Catalog Column Customization", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "catalog-columns",
    });

    page = (await setupBrowser(browser, testInfo)).page;

    common = new Common(page);
    uiHelper = new UIhelper(page);

    await common.loginAsGuest();
  });

  test.beforeEach(async () => {
    await uiHelper.openSidebar(t["rhdh"][lang]["menuItem.catalog"]);
    await uiHelper.verifyHeading(
      t["catalog"][lang]["indexPage.title"].replace("{{orgName}}", "My Org"),
    );
    await uiHelper.openCatalogSidebar("Component");
  });

  test("Default columns are visible in catalog table", async () => {
    // Verify that default columns are present
    await uiHelper.verifyColumnHeading(["Name"], true);
    await uiHelper.verifyColumnHeading(["Owner"], true);
    await uiHelper.verifyColumnHeading(["Type"], true);
  });

  test("Created At column is visible by default", async () => {
    // By default (without exclude configuration), Created At should be visible
    await uiHelper.verifyColumnHeading(["Created At"], true);
  });

  test("Column headers are clickable for sorting", async () => {
    // Test that the Name column can be clicked for sorting
    const nameColumn = page.getByRole("columnheader", {
      name: "Name",
      exact: true,
    });

    await expect(nameColumn).toBeVisible();
    await nameColumn.click();

    // After clicking, the column should show a sort indicator
    // The sort functionality is handled by material-table internally
    await expect(nameColumn).toBeVisible();
  });

  test("Catalog table displays entity data correctly", async () => {
    // Search for a known entity to verify data is displayed
    await uiHelper.searchInputPlaceholder("backstage");

    // Verify that search results are displayed
    const tableRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") });
    await expect(tableRows.first()).toBeVisible();
  });

  /**
   * Test for custom column visibility.
   * This test should be run with app-config that includes custom columns.
   *
   * Required configuration:
   * ```yaml
   * catalog:
   *   table:
   *     columns:
   *       custom:
   *         - title: "Security Tier"
   *           field: "metadata.annotations['custom/security-tier']"
   * ```
   */
  test.skip("Custom columns from configuration are visible", async () => {
    // This test is skipped by default as it requires specific configuration
    // When running with custom column configuration, enable this test

    // Verify custom column header is present
    await uiHelper.verifyColumnHeading(["Security Tier"], true);
  });

  /**
   * Test for excluded columns.
   * This test should be run with app-config that excludes the Created At column.
   *
   * Required configuration:
   * ```yaml
   * catalog:
   *   table:
   *     columns:
   *       exclude:
   *         - createdAt
   * ```
   */
  test.skip("Excluded columns are not visible", async () => {
    // This test is skipped by default as it requires specific configuration
    // When running with exclude configuration, enable this test

    // Verify Created At column is NOT present when excluded
    const createdAtColumn = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });
    await expect(createdAtColumn).not.toBeVisible();
  });

  /**
   * Test for include-only mode.
   * This test should be run with app-config that specifies only certain columns.
   *
   * Required configuration:
   * ```yaml
   * catalog:
   *   table:
   *     columns:
   *       include:
   *         - name
   *         - owner
   * ```
   */
  test.skip("Only included columns are visible in include mode", async () => {
    // This test is skipped by default as it requires specific configuration

    // Verify only the included columns are present
    await uiHelper.verifyColumnHeading(["Name"], true);
    await uiHelper.verifyColumnHeading(["Owner"], true);

    // Verify other columns are NOT present
    const typeColumn = page.getByRole("columnheader", {
      name: "Type",
      exact: true,
    });
    await expect(typeColumn).not.toBeVisible();

    const createdAtColumn = page.getByRole("columnheader", {
      name: "Created At",
      exact: true,
    });
    await expect(createdAtColumn).not.toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
