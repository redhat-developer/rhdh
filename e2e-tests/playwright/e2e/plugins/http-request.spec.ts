import { test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";
import { CatalogImport } from "../../support/pages/catalog-import";

// https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/scaffolder-actions/scaffolder-backend-module-http-request
// Pre-req: Enable roadiehq-scaffolder-backend-module-http-request-dynamic plugin
// Pre-req: Enable janus-idp-backstage-plugin-quay plugin
test.describe("Testing scaffolder-backend-module-http-request to invoke an external request", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;
  const template =
    "https://github.com/janus-qe/software-template/blob/main/test-http-request.yaml";

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
    catalogImport = new CatalogImport(page);
  });

  test("Create a software template using http-request plugin", async () => {
    test.setTimeout(130000);
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await uiHelper.verifyHeading("Templates");
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(template, false);

    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Template");
    await uiHelper.searchInputPlaceholder("Test HTTP Request");
    await uiHelper.clickLink("Test HTTP Request");
    await uiHelper.verifyHeading("Test HTTP Request");
    await uiHelper.clickLink("Launch Template");
    await uiHelper.verifyHeading("Self-service");
    await uiHelper.clickButton("Create");
    //Checking for Http Status 200
    await uiHelper.verifyText("200", false);
  });
});
