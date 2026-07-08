import { test, expect } from "@support/coverage/test";

import { CatalogBrowsePage } from "../../support/pages/catalog-browse-page";
import { HomePage } from "../../support/pages/home-page";

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

  test("Verify successful DB connection", async ({ page, authSession }) => {
    const homePage = new HomePage(page);
    const catalogBrowsePage = new CatalogBrowsePage(page);
    await authSession.loginWithKeycloak(
      process.env.GH_USER2_ID ?? "",
      process.env.GH_USER2_PASS ?? "",
    );
    await homePage.verifyWelcomeHeading();
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
