import { Page, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common, setupBrowser } from "../../../utils/common";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { APIHelper } from "../../../utils/api-helper";
import { GITHUB_API_ENDPOINTS } from "../../../utils/api-endpoints";
import { runAccessibilityTests } from "../../../utils/accessibility";

let page: Page;

test.describe.serial("Test Scaffolder Backend Module Annotator", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env

  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;

  const template =
    "https://github.com/backstage/community-plugins/blob/main/workspaces/scaffolder-backend-module-annotator/plugins/scaffolder-backend-module-annotator/examples/templates/01-scaffolder-template.yaml";

  const reactAppDetails = {
    owner: "janus-qe/maintainers",
    componentName: `test-annotator-${Date.now()}`,
    description: "react app for annotator test",
    label: "some-label",
    annotation: "some-annotation",
    repo: `test-annotator-${Date.now()}`,
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

  test("Register the annotator template", async ({}, testInfo) => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.verifyText("Name");

    await runAccessibilityTests(page, testInfo);

    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(template, false);
  });

  test("Scaffold a component using the annotator template", async () => {
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

    await uiHelper.verifyRowInTableByUniqueText("Owner", [
      `group:${reactAppDetails.owner}`,
    ]);
    await uiHelper.verifyRowInTableByUniqueText("Name", [
      reactAppDetails.componentName,
    ]);
    await uiHelper.verifyRowInTableByUniqueText("Description", [
      reactAppDetails.description,
    ]);
    await uiHelper.verifyRowInTableByUniqueText("Label", [
      reactAppDetails.label,
    ]);
    await uiHelper.verifyRowInTableByUniqueText("Annotation", [
      reactAppDetails.annotation,
    ]);
    await uiHelper.verifyRowInTableByUniqueText("Repository Location", [
      `github.com?owner=${reactAppDetails.repoOwner}&repo=${reactAppDetails.repo}`,
    ]);

    await uiHelper.clickButton("Create");

    const linkLocator = page
      .locator("a")
      .filter({ hasText: "Open in catalog" })
      .first();
    // scaffolder might take a bit longer to create the entity, so we wait for the link to be visible before clicking
    await linkLocator.waitFor({ state: "visible", timeout: 60_000 });
    await linkLocator.click();
  });

  test("Verify custom label is added to scaffolded component", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.searchInputPlaceholder(reactAppDetails.componentName);

    await uiHelper.verifyRowInTableByUniqueText(
      `${reactAppDetails.componentName}`,
      ["website"],
    );
    await uiHelper.clickLink(`${reactAppDetails.componentName}`);

    await catalogImport.inspectEntityAndVerifyYaml(
      `labels:\n    custom: ${reactAppDetails.label}\n`,
    );
  });

  test("Verify custom annotation is added to scaffolded component", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.searchInputPlaceholder(reactAppDetails.componentName);

    await uiHelper.verifyRowInTableByUniqueText(
      `${reactAppDetails.componentName}`,
      ["website"],
    );
    await uiHelper.clickLink(`${reactAppDetails.componentName}`);

    await catalogImport.inspectEntityAndVerifyYaml(
      `custom.io/annotation: ${reactAppDetails.annotation}`,
    );
  });

  test("Verify template version annotation is added to scaffolded component", async () => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.searchInputPlaceholder(reactAppDetails.componentName);

    await uiHelper.verifyRowInTableByUniqueText(
      `${reactAppDetails.componentName}`,
      ["website"],
    );
    await uiHelper.clickLink(`${reactAppDetails.componentName}`);

    await catalogImport.inspectEntityAndVerifyYaml(
      `backstage.io/template-version: 0.0.1`,
    );
  });

  test("Verify template version annotation is present on the template", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Template");

    await uiHelper.searchInputPlaceholder("Create React App Template\n");
    await uiHelper.verifyRowInTableByUniqueText("Create React App Template", [
      "website",
    ]);
    await uiHelper.clickLink("Create React App Template");

    await catalogImport.inspectEntityAndVerifyYaml(
      `backstage.io/template-version: 0.0.1`,
    );
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
});
