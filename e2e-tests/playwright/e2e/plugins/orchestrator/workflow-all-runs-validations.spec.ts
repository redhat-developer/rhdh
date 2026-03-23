import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

test.describe("Orchestrator Workflow Runs tests", () => {
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2184 fix orchestrator tests on Operator deployment
  test.fixme(() => skipIfJobName(JOB_NAME_PATTERNS.OPERATOR));

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
