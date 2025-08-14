import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";

// Pre-req: backstage-plugin-catalog-backend-module-gitlab-dynamic
// Pre-req: immobiliarelabs-backstage-plugin-gitlab-backend-dynamic
//FIXME: RHDHBUGS-1977
test.describe.skip("gitlab discovery UI tests", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
    await uiHelper.openSidebar("Catalog");
  });

  test("GitLab integration for discovering catalog entities from GitLab", async () => {
    await uiHelper.verifyText("rhdh-my-new-service");
    await uiHelper.clickLink("rhdh-my-new-service");
    await uiHelper.verifyHeading("rhdh-my-new-service");
    await uiHelper.verifyText("Description of my new service");
    await uiHelper.verifyText("java");
    await uiHelper.verifyText("production");
    await uiHelper.verifyLink("team-a");
    await uiHelper.verifyLink("project-x");
    await uiHelper.verifyLink("View Source");
  });
});
