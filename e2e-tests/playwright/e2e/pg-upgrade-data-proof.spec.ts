import { expect } from "@playwright/test";
import { test } from "@support/coverage/test";

import { CatalogBrowsePage } from "../support/pages/catalog-browse-page";

/**
 * RHIDP-14594: prove catalog data seeded on PG15 survives major upgrades.
 * Enabled only when CI sets PG_UPGRADE_DATA_PROOF=1 (see ocp-pull.sh).
 */
test.describe("PostgreSQL upgrade data persistence proof", () => {
  test.skip(
    () => process.env.PG_UPGRADE_DATA_PROOF !== "1",
    "Runs only during chart-managed PostgreSQL upgrade CI (PG_UPGRADE_DATA_PROOF=1)",
  );

  let catalogBrowsePage: CatalogBrowsePage;

  test.beforeAll(({ rhdhGuestPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
    catalogBrowsePage = new CatalogBrowsePage(rhdhGuestPage);
  });

  test("Seeded pg-upgrade-data-proof component is visible in Catalog UI", async ({
    rhdhGuestPage,
  }) => {
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.searchCatalog("pg-upgrade-data-proof");
    await catalogBrowsePage.verifyText("pg-upgrade-data-proof");

    await catalogBrowsePage.openEntityLink("pg-upgrade-data-proof");
    await catalogBrowsePage.verifyHeading("PG Upgrade Data Proof");
    await expect(rhdhGuestPage.getByText(/RHIDP-14594 persistence proof/i)).toBeVisible();
  });
});
