import { test } from "@playwright/test";
import { UIhelper } from "../utils/UIhelper";
import { Common } from "../utils/Common";
import { Sidebar, SidebarOptions } from "../support/pages/sidebar";

test.describe("Verify TLS configuration with external Postgres DB", () => {
  test.beforeEach(
    async ({ page }) => await new Common(page).checkAndClickOnGHloginPopup(),
  );

  test("Verify successful DB connection and display of expected entities in the Catalog", async ({
    page,
  }) => {
    const uiHelper = new UIhelper(page);
    const common = new Common(page);
    await common.loginAsGithubUser();
    await new Sidebar(page).open(SidebarOptions.Catalog);
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.verifyRowsInTable(["Backstage Showcase"]);
  });
});
