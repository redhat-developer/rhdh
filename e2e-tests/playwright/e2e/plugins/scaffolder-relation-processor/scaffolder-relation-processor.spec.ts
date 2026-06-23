import { expect, Page, test } from "@support/coverage/test";
import { Common } from "../../../utils/common";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { APIHelper } from "../../../utils/api-helper";
import { GITHUB_API_ENDPOINTS } from "../../../utils/api-endpoints";
import { ScaffolderFlowPage } from "../../../support/pages/scaffolder-flow-page";
import { CatalogBrowsePage } from "../../../support/pages/catalog-browse-page";
import {
  createManagedBrowserSession,
  type ManagedBrowserSession,
} from "../../../support/fixtures/managed-browser";

let page: Page;
let browserSession: ManagedBrowserSession;

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
    repoOwner: Buffer.from(
      process.env.GITHUB_ORG ?? "amFudXMtcWU=",
      "base64",
    ).toString("utf8"),
  };

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    browserSession = await createManagedBrowserSession(browser, testInfo);
    page = browserSession.page;

    common = new Common(page);
    scaffolderFlowPage = new ScaffolderFlowPage(page);
    catalogBrowsePage = new CatalogBrowsePage(page);
    catalogImport = new CatalogImport(page);

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
    // Wait for the scaffolder task to complete and the link to appear
    await expect(
      page.getByRole("link", { name: "Open in catalog" }),
    ).toBeVisible({
      timeout: 60000,
    });
    await scaffolderFlowPage.clickOpenInCatalog();
    // Ensure the entity page has loaded
    await expect(page.getByText(reactAppDetails.componentName)).toBeVisible({
      timeout: 20000,
    });
  });

  test("Verify scaffoldedFrom relation in dependency graph and raw YAML", async () => {
    // Verify the scaffoldedFrom relation in the YAML view of the entity
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
    await clickOnRelationTestComponent();

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

    // Verify the scaffolderOf relation in the YAML view
    await catalogImport.inspectEntityAndVerifyYaml(
      `- type: scaffolderOf\n    targetRef: component:default/${reactAppDetails.componentName}\n`,
    );

    // Verify the template is still functional
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
    await browserSession.dispose();
  });

  async function clickOnRelationTestComponent() {
    const selector = 'a[href*="/catalog/default/component/test-relation-"]';
    await page.locator(selector).first().waitFor({ state: "visible" });
    const link = page.locator(selector).first();
    await expect(link).toBeVisible();
    await link.click();
  }
});
