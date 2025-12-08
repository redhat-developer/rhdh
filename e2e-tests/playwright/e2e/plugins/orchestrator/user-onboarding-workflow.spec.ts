import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";

test.describe("Orchestrator user-onboarding workflow tests", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    await common.loginAsKeycloakUser();
  });

  test("User-onboarding workflow execution and workflow tab validation", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectUserOnboardingWorkflowItem();
    await orchestrator.runUserOnboardingWorkflow();
    await uiHelper.openSidebar("Orchestrator");
  });

  test("User-onboarding workflow validate abort workflow", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectUserOnboardingWorkflowItem();
    await orchestrator.runUserOnboardingWorkflow();
    await orchestrator.abortWorkflow();
  });
});
