import { expect } from "@playwright/test";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";
import { guestTest } from "../../../support/fixtures/guest-login";

guestTest.describe("dynamic-plugins-info UI tests", () => {
  guestTest.beforeEach(async ({ uiHelper }) => {
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Extensions");
    await uiHelper.verifyHeading("Extensions");
    await uiHelper.clickTab("Installed");
  });

  guestTest(
    "it should show a table, and the table should contain techdocs plugins",
    async ({ page, uiHelper }) => {
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
    },
  );

  guestTest(
    "it should have a plugin-tech-radar plugin which is Enabled and Preinstalled",
    async ({ page }) => {
      await page
        .getByPlaceholder("Filter", { exact: true })
        .pressSequentially("plugin-tech-radar\n", { delay: 300 });
      const row = page.locator(
        UI_HELPER_ELEMENTS.rowByText("backstage-community-plugin-tech-radar"),
      );
      expect(await row.locator("td").nth(2).innerText()).toBe("Yes"); // enabled
      expect(await row.locator("td").nth(3).innerText()).toBe("Yes"); // preinstalled
    },
  );

  guestTest(
    "it should have a plugin-3scale-backend plugin which is not Enabled but Preinstalled",
    async ({ page }) => {
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
      expect(await row.locator("td").nth(2).innerText()).toBe("No"); // not enabled
      expect(await row.locator("td").nth(3).innerText()).toBe("Yes"); // preinstalled
    },
  );

  // TODO: Enable this test once the behavior for loading this plugin is fixed.
  // TODO: In RHDH 1.5, this plugin incorrectly appears as disabled despite being properly imported and explicitly enabled.
  guestTest.skip(
    "it should have a plugin-todo-list plugin which is Enabled but not Preinstalled",
    async ({ page, uiHelper }) => {
      await page
        .getByPlaceholder("Search", { exact: true })
        .pressSequentially("plugin-todo\n", { delay: 300 });

      // Verify the Enabled and Preinstalled column values for the specific row
      await uiHelper.verifyPluginRow(
        "@backstage-community/plugin-todo", // Text to locate the row (Name column)
        "Yes", // Expected value in the Enabled column
        "No", // Expected value in the Preinstalled column
      );
    },
  );
});
