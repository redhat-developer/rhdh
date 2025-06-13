import { test } from "@playwright/test";
import { OrchestratorPages } from "../../utils/orchestrator_common/orchestratorPages";

test("OCP-xxxxx: Orchestrator user on-boarding workflow execution @onboarding @parallel", async ({
  page,
}) => {
  const orchestratorPages = new OrchestratorPages(page);
  await orchestratorPages.goto();
  await orchestratorPages.loginAsGuest();
  await orchestratorPages.clickOrchestratorNavBarItem();
  await orchestratorPages.selectUserOnboardingWorkflowItem();
  await orchestratorPages.runUserOnboardingWorkflow();
  await orchestratorPages.clickNotificationsNavBarItem();
  await orchestratorPages.notificationContains(/Onboarding user.*completed/);
});
