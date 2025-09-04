import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { UI_HELPER_ELEMENTS } from "../../../support/page-objects/global-obj";

test.describe("dynamic-plugins-info UI tests", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Extensions");
    await uiHelper.verifyHeading("Extensions");
    await uiHelper.clickTab("Installed");
  });

  test("it should show a table, and the table should contain techdocs plugins", async ({
    page,
  }) => {
    // what shows up in the list depends on how the instance is configured so
    // let's check for the main basic elements of the component to verify the
    // mount point is working as expected
    await uiHelper.verifyText(/Plugins \(\d+\)/);
    await uiHelper.verifyText("5 rows", false);
    await uiHelper.verifyColumnHeading(
      ["Name", "Version", "Enabled", "Preinstalled", "Role"],
      true,
    );

    // Check the filter and use that to verify that the table contains the
    // dynamic-plugins-info plugin, which is required for this test to run
    // properly anyways
    await page
      .getByPlaceholder("Filter", { exact: true })
      .pressSequentially("techdocs\n", { delay: 300 });
    await uiHelper.verifyRowsInTable(["backstage-plugin-techdocs"], true);
  });

  test("it should have a plugin-tech-radar plugin which is Enabled and Preinstalled", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Filter", { exact: true })
      .pressSequentially("plugin-tech-radar\n", { delay: 300 });
    const row = page.locator(
      UI_HELPER_ELEMENTS.rowByText("backstage-community-plugin-tech-radar"),
    );
    await expect(row.locator("td").nth(2)).toHaveText("Yes"); // enabled
    await expect(row.locator("td").nth(3)).toHaveText("Yes"); // preinstalled
  });

  test("it should have a plugin-3scale-backend plugin which is not Enabled but Preinstalled", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Filter", { exact: true })
      .pressSequentially("plugin-3scale-backend-dynamic\n", {
        delay: 100,
      });
    const row = page.locator(
      UI_HELPER_ELEMENTS.rowByText(
        "backstage-community-plugin-3scale-backend-dynamic",
      ),
    );
    await expect(row.locator("td").nth(2)).toHaveText("No"); // not enabled
    await expect(row.locator("td").nth(3)).toHaveText("Yes"); // preinstalled
  });

  test("it should have a plugin-todo-list plugin which is Enabled but not Preinstalled", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Filter", { exact: true })
      .pressSequentially("plugin-todo\n", { delay: 300 });

    // Verify the Enabled and Preinstalled column values for the specific row
    await uiHelper.verifyPluginRow(
      "@backstage-community/plugin-todo", // Text to locate the row (Name column)
      "Yes", // Expected value in the Enabled column
      "No", // Expected value in the Preinstalled column
    );
  });
});
