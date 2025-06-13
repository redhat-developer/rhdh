import { test, expect } from "@playwright/test";
import OrchestratorPageTestUtils from "../../utils/orchestrator/TestUtils/OrchestratorPageLocators";
import CommonPageTestUtils from "../../utils/orchestrator_common/Common";
import LoginPageTestUtils from "../../utils/orchestrator_common/Login";
import Workflows from "../../utils/orchestrator_common/Workflows";

export enum WorkflowNames {
  MOVE2KUBE = "Move2Kube workflow",
  GREETING_WORKFLOW = "Greeting workflow",
  MTA_ANALYSIS = "MTA Analysis",
}

test("OCP-71621: Orchestrator Workflow Validations @greeting @parallel", async ({ page }) => {
  await page.goto("/");
  await LoginPageTestUtils.signInAsGuest(page).click();
  await CommonPageTestUtils.getNavBarItem(page, "Orchestrator").click();
  await OrchestratorPageTestUtils.workflowsTab(page).click();
  const workflowHeader = page.getByRole("heading", { name: "Workflows" });
  await expect(workflowHeader).toBeVisible();
  await expect(workflowHeader).toHaveText("Workflows");
  await expect(Workflows.workflowsTable(page)).toBeVisible();
  if (`${process.env.MILESTONE}` >= "6") {
    expect(
    await CommonPageTestUtils.getInputByAriaLabel(page, "Search")
  ).toHaveAttribute("placeholder", "Search");
  } else { expect(
    await CommonPageTestUtils.getInputByAriaLabel(page, "Search")
  ).toHaveAttribute("placeholder", "Filter");
  }
  await expect(
    CommonPageTestUtils.getColumnWithText(page, "Name")
  ).toBeVisible();
  await expect(
    CommonPageTestUtils.getColumnWithText(page, "Category")
  ).toBeVisible();
  if (`${process.env.MILESTONE}` >= "6") {
    await expect(
      CommonPageTestUtils.getColumnWithText(page, "Workflow status")
    ).toBeVisible();
  }
  await expect(
    CommonPageTestUtils.getColumnWithText(page, "Last run")
  ).toBeVisible();
  await expect(
    CommonPageTestUtils.getColumnWithText(page, "Last run status")
  ).toBeVisible();
  if (`${process.env.MILESTONE}` == "3") {
    await expect(CommonPageTestUtils.getColumnWithText(page, "Avg. duration")).toBeVisible();
  }
  await expect(
    CommonPageTestUtils.getColumnWithText(page, "Actions")
  ).toBeVisible();
  const workFlowRow = page.locator(
    `tr:has-text("${WorkflowNames.GREETING_WORKFLOW}")`
  );
  await expect(workFlowRow.locator("td").nth(0)).toHaveText(
    "Greeting workflow"
  );
  await expect(workFlowRow.locator("td").nth(1)).toHaveText("Infrastructure");
  // await expect(workFlowRow.locator('td').nth(2)).toHaveText(RegExp("(\d{1,2})/(\d{1,2})/(\d{2,4}), (\d{1,2}):(\d{1,2}):(\d{1,2}) (AM|PM)"))
  if (`${process.env.MILESTONE}` >= "6") {
    await expect(workFlowRow.locator("td").nth(2)).toHaveText("Available");
    await expect(workFlowRow.locator("td").nth(3)).toHaveText(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{1,2}:\d{1,2} (AM|PM)$/);
    await expect(workFlowRow.locator("td").nth(4)).toHaveText("Completed");
  } else {
    await expect(workFlowRow.locator("td").nth(3)).toHaveText("Completed");
  }
  if (`${process.env.MILESTONE}` == "3") {
    await expect(workFlowRow.locator("td").nth(4)).toHaveText("a few seconds");
    await expect(workFlowRow.locator("td").nth(5)).toHaveText(
      "YAML based greeting workflow"
    );
  } else if (`${process.env.MILESTONE}` >= "6") {
    await expect(workFlowRow.locator("td").nth(5)).toHaveText(
      "YAML based greeting workflow"
    );
  } else {
    await expect(workFlowRow.locator("td").nth(4)).toHaveText(
      "YAML based greeting workflow"
    );
  }
  if (`${process.env.MILESTONE}` == "3") {
    await expect(
      workFlowRow.getByRole("button", { name: "Execute" })
    ).toBeVisible();
    await expect(workFlowRow.getByRole("button", { name: "View" })).toBeVisible();
  }
  else {
    await expect(workFlowRow.getByRole('button', { name: 'Run', exact: true }).first()).toBeVisible();
    await expect(workFlowRow.getByRole('button', { name: 'View runs' }).first()).toBeVisible();
    if (`${process.env.MILESTONE}` >= "6") await expect(workFlowRow.getByRole('button', { name: 'View input schema' }).first()).toBeVisible();
  }
});
