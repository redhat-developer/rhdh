import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

test.describe("Orchestrator failswitch workflow tests", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled to save disk space

  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    await common.loginAsKeycloakUser();
  });

  test("Failswitch workflow execution and workflow tab validation", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("OK");
    await orchestrator.reRunFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
    await orchestrator.reRunFailSwitchWorkflow("KO");
    await orchestrator.validateWorkflowStatus("Failed");
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.validateWorkflowAllRuns();
  });

  test("Failswitch workflow execution and test abort workflow", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
  });
});
