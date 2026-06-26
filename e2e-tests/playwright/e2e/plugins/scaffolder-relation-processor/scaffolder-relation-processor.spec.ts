import { test } from "@support/coverage/test";

import { CatalogBrowsePage } from "../../../support/pages/catalog-browse-page";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { ScaffolderFlowPage } from "../../../support/pages/scaffolder-flow-page";
import { GITHUB_API_ENDPOINTS } from "../../../utils/api-endpoints";
import { APIHelper } from "../../../utils/api-helper";
import { Common } from "../../../utils/common";
import { base64Decode } from "../../../utils/helper";

test.describe.serial("Test Scaffolder Relation Processor Plugin", () => {
  test.skip(
    () => (process.env.JOB_NAME ?? "").includes("osd-gcp"),
    "skipping due to RHDHBUGS-555 on OSD Env",
  );

  let scaffolderFlowPage: ScaffolderFlowPage;
  let catalogBrowsePage: CatalogBrowsePage;
  let common: Common;
  let catalogImport: CatalogImport;

  const template =
    "https://github.com/backstage/community-plugins/blob/main/workspaces/scaffolder-backend-module-annotator/plugins/scaffolder-backend-module-annotator/examples/templates/01-scaffolder-template.yaml";

  const reactAppDetails = {
    owner: "janus-qe/maintainers",
    componentName: `test-relation-${Date.now()}`,
    componentPartialName: `test-relation-`,
    description: "react app for relation processor test",
    label: "test-label",
    annotation: "test-annotation",
    repo: `test-relation-${Date.now()}`,
    repoOwner: base64Decode(process.env.GITHUB_ORG ?? "amFudXMtcWU="),
  };

  test.beforeAll(async ({ rhdhPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    common = new Common(rhdhPage);
    scaffolderFlowPage = new ScaffolderFlowPage(rhdhPage);
    catalogBrowsePage = new CatalogBrowsePage(rhdhPage);
    catalogImport = new CatalogImport(rhdhPage);

    await common.loginAsGuest();
  });

  test("Register the template for scaffolder relation processor", async () => {
    await catalogBrowsePage.openCatalogSidebar();
    await catalogBrowsePage.verifyText("Name");

    await scaffolderFlowPage.openSelfServiceFromCatalog();
    await scaffolderFlowPage.verifySelfServiceHeading();
    await scaffolderFlowPage.clickImportGitRepository();
    await catalogImport.registerExistingComponent(template, false);
  });

  test("Scaffold a component to test relation processing", async () => {
    await scaffolderFlowPage.openSelfServiceFromCatalog();
    await scaffolderFlowPage.fillCreateReactAppTemplateForm(reactAppDetails);

    await scaffolderFlowPage.clickCreate();
    await scaffolderFlowPage.waitForOpenInCatalogLink();
    await scaffolderFlowPage.clickOpenInCatalog();
    await scaffolderFlowPage.verifyComponentNameVisible(
      reactAppDetails.componentName,
    );
  });

  test("Verify scaffoldedFrom relation in dependency graph and raw YAML", async () => {
    await catalogImport.inspectEntityAndVerifyYaml(
      `relations:
        - type: ownedBy
            targetRef: group:janus-qe/maintainers
        - type: scaffoldedFrom
            targetRef: template:default/create-react-app-template-with-timestamp-entityref
        spec:
        type: website
        lifecycle: experimental
        owner: group:janus-qe/maintainers
        scaffoldedFrom: template:default/create-react-app-template-with-timestamp-entityref`,
    );

    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.searchCatalog("test-relation-\n");
    await catalogBrowsePage.openEntityLinkByHref(
      "/catalog/default/component/test-relation-",
    );

    await catalogBrowsePage.openDependenciesTab();

    await scaffolderFlowPage.verifyDependencyGraphLabels(
      'g[data-testid="label"]',
      'g[data-testid="node"]',
      "scaffolderOf / scaffoldedFrom",
      reactAppDetails.componentPartialName,
    );
  });

  test("Verify scaffolderOf relation on the template", async () => {
    await scaffolderFlowPage.openTemplateFromCatalog(
      "Create React App Template",
      "website",
    );

    await catalogImport.inspectEntityAndVerifyYaml(
      `- type: scaffolderOf\n    targetRef: component:default/${reactAppDetails.componentName}\n`,
    );

    await scaffolderFlowPage.launchTemplateAndVerifyIntro();
  });

  test.afterAll(async () => {
    await APIHelper.githubRequest(
      "DELETE",
      GITHUB_API_ENDPOINTS.deleteRepo(
        reactAppDetails.repoOwner,
        reactAppDetails.repo,
      ),
    );
  });
});
