import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { shouldSkipBasedOnJob } from "../../../utils/helper";
import { JOB_PATTERNS } from "../../../utils/constants";

test.describe("Orchestrator Workflow Runs tests", () => {
  test.skip(() => shouldSkipBasedOnJob(JOB_PATTERNS.OSD_GCP));

  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    await common.loginAsKeycloakUser();
  });

  test("Workflow All Runs Validation", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.validateWorkflowAllRuns();
  });
});
