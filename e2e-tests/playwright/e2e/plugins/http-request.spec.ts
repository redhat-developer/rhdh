import { CatalogImport } from "../../support/pages/catalog-import";
import { guestTest } from "../../support/fixtures/guest-login";

// https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/scaffolder-actions/scaffolder-backend-module-http-request
// Pre-req: Enable roadiehq-scaffolder-backend-module-http-request-dynamic plugin
// Pre-req: Enable janus-idp-backstage-plugin-quay plugin
//TODO Re-enable when roadiehq-scaffolder-backend-module-http-request-dynamic is included in the Helm image
guestTest.describe(
  "Testing scaffolder-backend-module-http-request to invoke an external request",
  () => {
    guestTest.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env

    const template =
      "https://github.com/janus-qe/software-template/blob/main/test-http-request.yaml";

    guestTest(
      "Create a software template using http-request plugin",
      async ({ uiHelper, page }) => {
        guestTest.setTimeout(130000);
        await uiHelper.clickLink({ ariaLabel: "Self-service" });
        await uiHelper.verifyHeading("Templates");
        await uiHelper.clickButton("Register Existing Component");
        await new CatalogImport(page).registerExistingComponent(
          template,
          false,
        );

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
      },
    );
  },
);
