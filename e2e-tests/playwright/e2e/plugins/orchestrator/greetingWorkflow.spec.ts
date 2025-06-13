import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";

test.describe("Greeting workflow tests", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    orchestrator = new Orchestrator(page);
    await common.loginAsKeycloakUser();
  });

  test("Orchestrator greeting workflow execution", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectGreetingWorkflowItem();
    await orchestrator.runGreetingWorkflow();
  });
});
