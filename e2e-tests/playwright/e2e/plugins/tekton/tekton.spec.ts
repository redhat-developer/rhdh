import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Tekton } from "../../../utils/tekton/tekton";
import { Catalog } from "../../../support/pages/catalog";

// Pre-req: Enable tekton, kubernetes, kubernetes-backend plugins
// Pre-req: install Red Hat OpenShift Pipelines Operator
// Pre-req: Create a pipeline run
// Pre-req: A kubernetes cluster containing pipeline and pipelinerun resources labeled with backstage.io/kubernetes-id: developer-hub
// Pre-req: A catalog entity with the matching backstage.io/kubernetes-id: developer-hub annotation as well as the tekton.dev/cicd: "true" annotation
//          The old janus-idp.io/tekton annotation is deprecated but still supported!

test.describe("Test Tekton plugin", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let tekton: Tekton;
  let catalog: Catalog;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    const page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    await common.loginAsGuest();
    uiHelper = new UIhelper(page);
    tekton = new Tekton(page);
    catalog = new Catalog(page);
  });

  test("Check Pipeline Run", async () => {
    await catalog.goToBackstageJanusProjectCITab();
    await tekton.ensurePipelineRunsTableIsNotEmpty();
    await uiHelper.verifyHeading("Pipeline Runs");
    await uiHelper.verifyTableHeadingAndRows(
      tekton.getAllGridColumnsTextForPipelineRunsTable(),
    );
  });

  test("Check search functionality", async () => {
    await catalog.goToBackstageJanusProjectCITab();
    await tekton.search("hello-world"); //name of the PipelineRun
    await tekton.ensurePipelineRunsTableIsNotEmpty();
  });

  test("Check if modal is opened after click on the pipeline stage", async () => {
    await catalog.goToBackstageJanusProjectCITab();
    await tekton.clickOnExpandRowFromPipelineRunsTable();
    await tekton.openModalEchoHelloWorld();
    await tekton.isModalOpened();
    await tekton.checkPipelineStages(["echo-hello-world", "echo-bye"]);
  });
});
