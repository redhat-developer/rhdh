import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { NotificationPage } from "../../../support/pages/notifications";

test.describe("Orchestrator user onboarding workflow tests", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;
  let notificationPage: NotificationPage;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    notificationPage = new NotificationPage(page);
    await common.loginAsKeycloakUser();
  });

  test("User onboarding workflow execution and notification validation", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectUserOnboardingWorkflowItem();
    await orchestrator.runUserOnboardingWorkflow();
    await notificationPage.clickNotificationsNavBarItem();
    await notificationPage.notificationContains(/Onboarding user.*completed/);
  });
});
