import { expect, Page, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common, setupBrowser } from "../../../utils/common";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { APIHelper } from "../../../utils/api-helper";
import { GITHUB_API_ENDPOINTS } from "../../../utils/api-endpoints";

let page: Page;

// FIXME: fix Relation Catalog feature and re-enable tests https://issues.redhat.com/browse/RHDHBUGS-2578
test.describe.fixme("Test Scaffolder Relation Processor Plugin", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env

  let uiHelper: UIhelper;
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
      process.env.GITHUB_ORG || "amFudXMtcWU=",
      "base64",
    ).toString("utf8"), // Default repoOwner janus-qe
  };

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    page = (await setupBrowser(browser, testInfo)).page;

    common = new Common(page);
    uiHelper = new UIhelper(page);
    catalogImport = new CatalogImport(page);

    await common.loginAsGuest();
  });

  test("Register the template for scaffolder relation processor", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.verifyText("Name");

    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(template, false);
  });

  test("Scaffold a component to test relation processing", async () => {
    test.setTimeout(130000);
    await uiHelper.openSidebar("Catalog");
    await uiHelper.clickButton("Self-service");
    await uiHelper.searchInputPlaceholder("Create React App Template");
    await uiHelper.verifyText("Create React App Template");
    await uiHelper.waitForTextDisappear("Add ArgoCD to an existing project");
    await uiHelper.clickButton("Choose");

    await uiHelper.fillTextInputByLabel("Name", reactAppDetails.componentName);
    await uiHelper.fillTextInputByLabel(
      "Description",
      reactAppDetails.description,
    );
    await uiHelper.fillTextInputByLabel("Owner", reactAppDetails.owner);
    await uiHelper.fillTextInputByLabel("Label", reactAppDetails.label);
    await uiHelper.fillTextInputByLabel(
      "Annotation",
      reactAppDetails.annotation,
    );
    await uiHelper.clickButton("Next");

    await uiHelper.fillTextInputByLabel("Owner", reactAppDetails.repoOwner);
    await uiHelper.fillTextInputByLabel("Repository", reactAppDetails.repo);
    await uiHelper.pressTab();
    await uiHelper.clickButton("Review");

    await uiHelper.clickButton("Create");

    const linkLocator = page
      .locator("a")
      .filter({ hasText: "Open in catalog" })
      .first();
    // scaffolder might take a bit longer to create the entity, so we wait for the link to be visible before clicking
    await linkLocator.waitFor({ state: "visible", timeout: 60_000 });
    await linkLocator.click();
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

    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.searchInputPlaceholder("test-relation-\n");
    await clickOnRelationTestComponent();

    await uiHelper.clickTab("Dependencies");

    const labelSelector = 'g[data-testid="label"]';
    const nodeSelector = 'g[data-testid="node"]';

    await uiHelper.verifyTextInSelector(
      labelSelector,
      "scaffolderOf / scaffoldedFrom",
    );

    await uiHelper.verifyPartialTextInSelector(
      nodeSelector,
      reactAppDetails.componentPartialName,
    );
  });

  test("Verify scaffolderOf relation on the template", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Template");

    await uiHelper.searchInputPlaceholder("Create React App Template\n");
    await uiHelper.verifyRowInTableByUniqueText("Create React App Template", [
      "website",
    ]);
    await uiHelper.clickLink("Create React App Template");

    // Verify the scaffolderOf relation in the YAML view
    await catalogImport.inspectEntityAndVerifyYaml(
      `- type: scaffolderOf\n    targetRef: component:default/${reactAppDetails.componentName}\n`,
    );

    // Verify the template is still functional
    await uiHelper.clickLink("Launch Template");
    await uiHelper.verifyText("Provide some simple information");
  });

  test.afterAll(async () => {
    await APIHelper.githubRequest(
      "DELETE",
      GITHUB_API_ENDPOINTS.deleteRepo(
        reactAppDetails.repoOwner,
        reactAppDetails.repo,
      ),
    );
    await page.close();
  });

  async function clickOnRelationTestComponent() {
    const selector = 'a[href*="/catalog/default/component/test-relation-"]';
    await page.locator(selector).first().waitFor({ state: "visible" });
    const link = page.locator(selector).first();
    await expect(link).toBeVisible();
    await link.click();
  }
});
