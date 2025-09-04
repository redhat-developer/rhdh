import { test, expect } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
test.describe("Verify TLS configuration with external Postgres DB", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "data-management",
    });
  });

  test("Verify successful DB connection and display of expected entities in the Home Page and Catalog", async ({
    page,
  }) => {
    const uiHelper = new UIhelper(page);
    const common = new Common(page);
    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
    await uiHelper.verifyHeading("Welcome back!");
    await uiHelper.verifyText("Explore Your Software Catalog");
    await page.getByLabel("Catalog").first().click();
    await uiHelper.selectMuiBox("Kind", "Component");
    await expect(async () => {
      await uiHelper.clickByDataTestId("user-picker-all");
      await uiHelper.verifyRowsInTable(["test-rhdh-qe-2-team-owned"]);
    }).toPass({
      intervals: [1_000, 2_000],
      timeout: 15_000,
    });
  });
});
