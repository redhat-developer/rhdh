import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

// Pre-req: backstage-plugin-catalog-backend-module-gitlab-dynamic
// Pre-req: immobiliarelabs-backstage-plugin-gitlab-backend-dynamic
// Using GH_USER_ID account
test.describe("gitlab discovery UI tests", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
    await uiHelper.openSidebar("Catalog");
  });

  test("GitLab integration for discovering catalog entities from GitLab", async ({
    page,
  }) => {
    // Dismiss quickstart overlay if visible — it can interfere with search input
    await uiHelper.hideQuickstartIfVisible();
    // Wait for catalog table search input to be ready before searching
    await page.getByRole("textbox", { name: "Search" }).waitFor({ state: "visible" });
    await uiHelper.searchInputPlaceholder("scaffoldedForm");
    await uiHelper.verifyText("scaffoldedForm-test");
    await uiHelper.clickLink("scaffoldedForm-test");
    await uiHelper.verifyHeading("scaffoldedForm-test");
    await uiHelper.verifyText("My Description");
    await uiHelper.verifyText("experimental");
    await uiHelper.verifyText("website");
    await uiHelper.verifyLink("View Source");
  });
});
