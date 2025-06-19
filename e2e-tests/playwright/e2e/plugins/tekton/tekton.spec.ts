import { Tekton } from "../../../utils/tekton/tekton";
import { Catalog } from "../../../support/pages/catalog";
import { guestTest } from "../../../support/fixtures/guest-login";

// Pre-req: Enable tekton, kubernetes, kubernetes-backend plugins
// Pre-req: install Red Hat OpenShift Pipelines Operator
// Pre-req: Create a pipeline run
// Pre-req: A kubernetes cluster containing pipeline and pipelinerun resources labeled with backstage.io/kubernetes-id: developer-hub
// Pre-req: A catalog entity with the matching backstage.io/kubernetes-id: developer-hub annotation as well as the tekton.dev/cicd: "true" annotation
//          The old janus-idp.io/tekton annotation is deprecated but still supported!

guestTest.describe("Test Tekton plugin", () => {
  let tekton: Tekton;
  let catalog: Catalog;

  guestTest.beforeAll(async ({ page }) => {
    tekton = new Tekton(page);
    catalog = new Catalog(page);
  });

  guestTest("Check Pipeline Run", async ({ uiHelper }) => {
    await catalog.goToBackstageJanusProjectCITab();
    await tekton.ensurePipelineRunsTableIsNotEmpty();
    await uiHelper.verifyHeading("Pipeline Runs");
    await uiHelper.verifyTableHeadingAndRows(
      tekton.getAllGridColumnsTextForPipelineRunsTable(),
    );
  });

  guestTest("Check search functionality", async () => {
    await catalog.goToBackstageJanusProjectCITab();
    await tekton.search("hello-world"); //name of the PipelineRun
    await tekton.ensurePipelineRunsTableIsNotEmpty();
  });

  guestTest(
    "Check if modal is opened after click on the pipeline stage",
    async () => {
      await catalog.goToBackstageJanusProjectCITab();
      await tekton.clickOnExpandRowFromPipelineRunsTable();
      await tekton.openModalEchoHelloWorld();
      await tekton.isModalOpened();
      await tekton.checkPipelineStages(["echo-hello-world", "echo-bye"]);
    },
  );
});
