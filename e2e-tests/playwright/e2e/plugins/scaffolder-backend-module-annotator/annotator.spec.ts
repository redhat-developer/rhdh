import { Page, test, expect } from "@support/coverage/test";
import { Common } from "../../../utils/common";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { APIHelper } from "../../../utils/api-helper";
import { GITHUB_API_ENDPOINTS } from "../../../utils/api-endpoints";
import { runAccessibilityTests } from "../../../utils/accessibility";
import { ScaffolderFlowPage } from "../../../support/pages/scaffolder-flow-page";
import { CatalogBrowsePage } from "../../../support/pages/catalog-browse-page";
import {
  createManagedBrowserSession,
  type ManagedBrowserSession,
} from "../../../support/fixtures/managed-browser";

let page: Page;
let browserSession: ManagedBrowserSession;

test.describe.serial("Test Scaffolder Backend Module Annotator", () => {
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
    componentName: `test-annotator-${Date.now()}`,
    description: "react app for annotator test",
    label: "some-label",
    annotation: "some-annotation",
    repo: `test-annotator-${Date.now()}`,
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

  test("Register the annotator template", async ({}, testInfo) => {
    await catalogBrowsePage.openCatalogSidebar();
    await catalogBrowsePage.verifyText("Name");

    await runAccessibilityTests(page, testInfo);

    await scaffolderFlowPage.openSelfServiceFromCatalog();
    await scaffolderFlowPage.clickImportGitRepository();
    await catalogImport.registerExistingComponent(template, false);
  });

  test("Scaffold a component using the annotator template", async () => {
    await scaffolderFlowPage.openSelfServiceFromCatalog();
    await scaffolderFlowPage.verifySelfServiceHeading();
    await scaffolderFlowPage.fillCreateReactAppTemplateForm(reactAppDetails);

    await scaffolderFlowPage.verifyCreateReactAppReviewTableWithGroupOwner(
      reactAppDetails,
    );

    await scaffolderFlowPage.clickCreate();
    await expect(
      page.getByRole("link", { name: "Open in catalog" }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await scaffolderFlowPage.clickOpenInCatalog();
  });

  test("Verify custom label is added to scaffolded component", async () => {
    await scaffolderFlowPage.openComponentInCatalog(
      reactAppDetails.componentName,
    );

    await catalogImport.inspectEntityAndVerifyYaml(
      `labels:\n    custom: ${reactAppDetails.label}\n`,
    );
  });

  test("Verify custom annotation is added to scaffolded component", async () => {
    await scaffolderFlowPage.openComponentInCatalog(
      reactAppDetails.componentName,
    );

    await catalogImport.inspectEntityAndVerifyYaml(
      `custom.io/annotation: ${reactAppDetails.annotation}`,
    );
  });

  test("Verify template version annotation is added to scaffolded component", async () => {
    await scaffolderFlowPage.openComponentInCatalog(
      reactAppDetails.componentName,
    );

    await catalogImport.inspectEntityAndVerifyYaml(
      `backstage.io/template-version: 0.0.1`,
    );
  });

  test("Verify template version annotation is present on the template", async () => {
    await scaffolderFlowPage.openTemplateFromCatalog(
      "Create React App Template",
      "website",
    );

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
    await browserSession.dispose();
  });
});
