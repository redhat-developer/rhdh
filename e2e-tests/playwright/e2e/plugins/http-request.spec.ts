import { test } from "@support/coverage/test";

import { CatalogImport } from "../../support/pages/catalog-import";
import { ScaffolderFlowPage } from "../../support/pages/scaffolder-flow-page";
import { SelfServicePage } from "../../support/pages/self-service-page";
import { JOB_NAME_PATTERNS } from "../../utils/constants";
import { skipIfJobName } from "../../utils/helper";

// https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/scaffolder-actions/scaffolder-backend-module-http-request
// Pre-req: Enable roadiehq-scaffolder-backend-module-http-request-dynamic plugin
// Pre-req: Enable janus-idp-backstage-plugin-quay plugin
test.describe("Testing scaffolder-backend-module-http-request to invoke an external request", () => {
  test.skip(
    () => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP),
    "skipping due to RHDHBUGS-555 on OSD Env",
  );
  let selfServicePage: SelfServicePage;
  let scaffolderFlowPage: ScaffolderFlowPage;
  let catalogImport: CatalogImport;
  const template = "https://github.com/janus-qe/software-template/blob/main/test-http-request.yaml";

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(({ guestPage }) => {
    selfServicePage = new SelfServicePage(guestPage);
    scaffolderFlowPage = new ScaffolderFlowPage(guestPage);
    catalogImport = new CatalogImport(guestPage);
  });

  test("Create a software template using http-request plugin", async () => {
    await selfServicePage.open();
    await selfServicePage.verifyTemplatesHeading();
    await selfServicePage.clickImportGitRepository();
    await catalogImport.registerExistingComponent(template, false);

    await scaffolderFlowPage.runHttpRequestTemplateFlow();
  });
});
