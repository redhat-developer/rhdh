import { test, expect } from "@support/coverage/test";

import { CatalogBrowsePage } from "../../support/pages/catalog-browse-page";
import { RhdhHomePage } from "../../support/pages/rhdh-home-page";
import { Common } from "../../utils/common";

test.describe("Verify TLS configuration with external Crunchy Postgres DB", () => {
  test.beforeAll(() => {
    test.info().annotations.push(
      {
        type: "component",
        description: "data-management",
      },
      {
        type: "namespace",
        description: process.env.NAME_SPACE_RBAC ?? "showcase-rbac",
      },
    );
  });

  test("Verify successful DB connection", async ({ page }) => {
    const rhdhHomePage = new RhdhHomePage(page);
    const catalogBrowsePage = new CatalogBrowsePage(page);
    const common = new Common(page);
    await common.loginAsKeycloakUser(process.env.GH_USER2_ID, process.env.GH_USER2_PASS);
    await rhdhHomePage.verifyWelcomeHeading();
    await page.getByLabel("Catalog").first().click();
    await catalogBrowsePage.selectKind("Component");
    await expect(async () => {
      await catalogBrowsePage.clickByDataTestId("user-picker-all");
      await catalogBrowsePage.verifyTableRows(["test-rhdh-qe-2-team-owned"]);
    }).toPass({
      intervals: [1_000, 2_000],
      timeout: 15_000,
    });
  });
});
