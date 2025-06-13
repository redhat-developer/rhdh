import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";

test.describe("Greeting workflow Run Details tests", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    orchestrator = new Orchestrator(page);
    await common.loginAsKeycloakUser();
  });

  test("OCP-71620: Orchestrator Workflow Runs Validations @greeting @parallel", async ({ page }) => {
    await page.goto("/");
    await CommonPageTestUtils.getNavBarItem(page, "Orchestrator").click();
    if (`${process.env.MILESTONE}` == '3') {
      await OrchestratorPageTestUtils.workflowRunsTab(page).click();
    }
    else {
      await OrchestratorPageTestUtils.allRunsTab(page).click();
    }
    let headerName = "All runs"
    if (`${process.env.MILESTONE}` == '3') {
      headerName = "Workflow Runs"
      const workflowRunsHeader = page.getByRole("heading", {
        name: headerName,
      });
      await expect(workflowRunsHeader).toBeVisible();
      await expect(workflowRunsHeader).toHaveText(headerName);
    }
    await expect(
      OrchestratorPageTestUtils.workflowInstanceTableCell(page, 0, 0)
    ).toBeVisible();
    await expect(page.getByTestId("select").first()).toHaveAttribute(
      "aria-label",
      "Status"
    );
    await page.getByTestId("select").first().click();
    await expect(page.getByRole("option", { name: "All" })).toHaveText("All");
    await expect(page.getByRole("option", { name: "Active" })).toHaveText(
      "Active"
    );
    await expect(page.getByRole("option", { name: "Error" })).toHaveText("Error");
    await expect(page.getByRole("option", { name: "Completed" })).toHaveText(
      "Completed"
    );
    await expect(page.getByRole("option", { name: "Aborted" })).toHaveText(
      "Aborted"
    );
    await expect(page.getByRole("option", { name: "Suspended" })).toHaveText(
      "Suspended"
    );
    await page.getByRole("option", { name: "All" }).click();
    await expect(CommonPageTestUtils.getColumnWithText(page, "ID")).toBeVisible();
    let name = ""
    let status = ""
    if (`${process.env.MILESTONE}` == '3') {
      name = "Name"
    } else {
      name = "Workflow name"
    }
    if (`${process.env.MILESTONE}` >= '6') {
      status = "Run Status"
    } else {
      status = "Status"
    }
    await expect(
      CommonPageTestUtils.getColumnWithText(page, name)
    ).toBeVisible();
    await expect(
      CommonPageTestUtils.getColumnWithText(page, status)
    ).toBeVisible();
    await expect(
      CommonPageTestUtils.getColumnWithText(page, "Category")
    ).toBeVisible();
    await expect(
      CommonPageTestUtils.getColumnWithText(page, "Started")
    ).toBeVisible();
    await expect(
      CommonPageTestUtils.getColumnWithText(page, "Duration")
    ).toBeVisible();
  });
});
