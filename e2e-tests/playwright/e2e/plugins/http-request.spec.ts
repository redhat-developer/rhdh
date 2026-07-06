import { test } from "@support/coverage/test";

import { CatalogImport } from "../../support/pages/catalog-import";
import { ScaffolderFlowPage } from "../../support/pages/scaffolder-flow-page";
import { SelfServicePage } from "../../support/pages/self-service-page";
import { Common } from "../../utils/common";

// https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/scaffolder-actions/scaffolder-backend-module-http-request
// Pre-req: Enable roadiehq-scaffolder-backend-module-http-request-dynamic plugin
// Pre-req: Enable janus-idp-backstage-plugin-quay plugin
test.describe("Testing scaffolder-backend-module-http-request to invoke an external request", () => {
  test.skip(
    () => (process.env.JOB_NAME ?? "").includes("osd-gcp"),
    "skipping due to RHDHBUGS-555 on OSD Env",
  );
  let selfServicePage: SelfServicePage;
  let scaffolderFlowPage: ScaffolderFlowPage;
  let common: Common;
  let catalogImport: CatalogImport;
  const template = "https://github.com/janus-qe/software-template/blob/main/test-http-request.yaml";

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }) => {
    selfServicePage = new SelfServicePage(page);
    scaffolderFlowPage = new ScaffolderFlowPage(page);
    common = new Common(page);
    await common.loginAsGuest();
    catalogImport = new CatalogImport(page);
  });

  test("Create a software template using http-request plugin", async () => {
    await selfServicePage.open();
    await selfServicePage.verifyTemplatesHeading();
    await selfServicePage.clickImportGitRepository();
    await catalogImport.registerExistingComponent(template, false);

    await scaffolderFlowPage.runHttpRequestTemplateFlow();
  });
});
