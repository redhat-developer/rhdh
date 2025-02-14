import { test, expect } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UiHelper } from "../../../utils/ui-helper";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";

// TODO: reenable tests
test.describe.skip('Check RBAC "analytics-provider-segment" plugin', () => {
  let common: Common;
  let uiHelper: UiHelper;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UiHelper(page);
    common = new Common(page);
    await common.loginAsKeycloakUser();
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Plugins");
    await uiHelper.verifyHeading("Plugins");
  });

  test("is disabled", async ({ page }) => {
    await page
      .getByPlaceholder("Search")
      .pressSequentially("plugin-analytics-provider-segment\n", {
        delay: 300,
      });
    const row = page.locator(
      UI_HELPER_ELEMENTS.rowByText(
        "backstage-community-plugin-analytics-provider-segment",
      ),
    );
    expect(await row.locator("td").nth(2).innerText()).toBe("No"); // not enabled
  });
});
