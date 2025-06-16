import { expect, type Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import Workflows from "./workflows";

export class Orchestrator {
  private readonly page: Page;
  private readonly uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async openWorkflowAlert() {
    // This is only valid for MILESTONE 2
    const alert = this.page.getByRole("alert");
    await alert.getByRole("button").nth(0).click();
  }

  async closeWorkflowAlert() {
    await this.page.getByRole("alert").getByRole("button").nth(2).click();
  }

  async selectUserOnboardingWorkflowItem() {
    const workflowHeader = this.page.getByRole("heading", {
      name: "Workflows",
    });
    await expect(workflowHeader).toBeVisible();
    await expect(workflowHeader).toHaveText("Workflows");
    await expect(Workflows.workflowsTable(this.page)).toBeVisible();
    await this.page.getByRole("link", { name: "User Onboarding" }).click();
  }

  async selectGreetingWorkflowItem() {
    const workflowHeader = this.page.getByRole("heading", {
      name: "Workflows",
    });
    await expect(workflowHeader).toBeVisible();
    await expect(workflowHeader).toHaveText("Workflows");
    await expect(Workflows.workflowsTable(this.page)).toBeVisible();
    await this.page.getByRole("link", { name: "Greeting workflow" }).click();
  }

  async runGreetingWorkflow(language = "English", status = "Completed") {
    const runButton = this.page.getByRole('button', { name: "Run" });
    await expect(runButton).toBeVisible();
    await runButton.click();
    if (`${process.env.MILESTONE}` == "2") {
      await this.page.locator("#root_language").click();
      await this.page.getByRole("option", { name: language }).click();
    } else {
      await this.page.getByLabel("Language").click();
      await this.page.getByRole("option", { name: "English" }).click();
    }
    await this.page.getByRole('button', { name: "Next" }).click();
    await this.page.getByRole('button', { name: "Run" }).click();
    await expect(this.page.getByText(`${status}`, { exact: true })).toBeVisible(
      {
        timeout: 600000,
      }
    );
  }

  async reRunGreetingWorkflow(language = "English", status = "Completed") {
    if (`${process.env.MILESTONE}` >= "6") {
      await expect(
        this.page.getByText("Run again")
      ).toBeVisible();
      await this.page.getByText("Run again").click();
    } else {
      await expect(
        this.page.getByRole('button', { name: "Rerun" })
      ).toBeVisible();
      await this.page.getByRole('button', { name: "Rerun" }).click();
    }
    if (`${process.env.MILESTONE}` == "2") {
      await this.page.locator("#root_language").click();
      await this.page.getByRole("option", { name: language }).click();
    } else {
      await this.page.getByLabel("Language").click();
      await this.page.getByRole("option", { name: "English" }).click();
    }
    await this.page.getByRole('button', { name: "Next" }).click();
    await this.page.getByRole('button', { name: "Run" }).click();
    await expect(this.page.getByText(`${status}`, { exact: true })).toBeVisible(
      {
        timeout: 600000,
      }
    );
  }

  async validateGreetingWorkflow() {
    await this.page.getByRole('tab', { name: 'Workflows' }).click();
      const workflowHeader = this.page.getByRole("heading", { name: "Workflows" });
      await expect(workflowHeader).toBeVisible();
      await expect(workflowHeader).toHaveText("Workflows");
      await expect(Workflows.workflowsTable(this.page)).toBeVisible();
      if (`${process.env.MILESTONE}` >= "6") {
        expect(
        await this.page.locator(`input[aria-label="Search"]`)
      ).toHaveAttribute("placeholder", "Search");
      } else { expect(
        await this.page.locator(`input[aria-label="Search"]`)
      ).toHaveAttribute("placeholder", "Filter");
      }
      await expect(
        this.page.getByRole('columnheader', { name: "Name", exact: true})
      ).toBeVisible();
      await expect(
        this.page.getByRole('columnheader', { name: "Category", exact: true})
      ).toBeVisible();
      if (`${process.env.MILESTONE}` >= "6") {
        await expect(
          this.page.getByRole('columnheader', { name: "Workflow status", exact: true})
        ).toBeVisible();
      }
      await expect(
        this.page.getByRole('columnheader', { name: "Last run", exact: true})
      ).toBeVisible();
      await expect(
        this.page.getByRole('columnheader', { name: "Last run status", exact: true})
      ).toBeVisible();
      if (`${process.env.MILESTONE}` == "3") {
        await expect(this.page.getByRole('columnheader', { name: "Avg. duration", exact: true})).toBeVisible();
      }
      await expect(
        this.page.getByRole('columnheader', { name: "Actions", exact: true})
      ).toBeVisible();
      const workFlowRow = this.page.locator(
        `tr:has-text("Greeting workflow")`
      );
      await expect(workFlowRow.locator("td").nth(0)).toHaveText(
        "Greeting workflow"
      );
      await expect(workFlowRow.locator("td").nth(1)).toHaveText("Infrastructure");
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
  }

  async validateWorkflowRunsDetails() {
    await expect(this.page.getByText("Details")).toBeVisible();
    await expect(this.page.getByText("Results")).toBeVisible();
    if (`${process.env.MILESTONE}` == '3') {
      await expect(this.page.getByText("Workflow definition")).toBeVisible();
    }
    await expect(this.page.getByText("Workflow progress")).toBeVisible();
    let workFlowStatusRegex: RegExp
    if (`${process.env.MILESTONE}` >= "6") {
      workFlowStatusRegex = /^Completed$/
    } else {
      workFlowStatusRegex = /^Status Completed$/
    }
    await expect(
      this.page
        .locator("div")
        .filter({ hasText: workFlowStatusRegex })
        .first()
    ).toBeVisible();
    if (`${process.env.MILESTONE}` == '3') {
      await expect(this.page.locator('[data-testid="kogito-iframe"]')).toBeVisible();
    }
  }

  async validateWorkflowAllRuns() {
    if (`${process.env.MILESTONE}` == '3') {
      await this.page.getByRole('tab', { name: 'workflow runs' }).click();
    }
    else {
      await this.page.getByRole('tab', { name: 'all runs' }).click();
    }
    let headerName = "All runs"
    if (`${process.env.MILESTONE}` == '3') {
      headerName = "Workflow Runs"
      const workflowRunsHeader = this.page.getByRole("heading", {
        name: headerName,
      });
      await expect(workflowRunsHeader).toBeVisible();
      await expect(workflowRunsHeader).toHaveText(headerName);
    }
    await expect(
      this.page.locator('tbody').getByRole('row').nth(0).getByRole('cell').nth(0)
    ).toBeVisible();
    await expect(this.page.getByTestId("select").first()).toHaveAttribute(
      "aria-label",
      "Status"
    );
    await this.page.getByTestId("select").first().click();
    
    const statuses = ["All", "Active", "Error", "Completed", "Aborted", "Suspended"]
    for (const status of statuses) {
      await expect(this.page.getByRole("option", { name: status })).toHaveText(status);
    }
    await this.page.getByRole("option", { name: "All" }).click();

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
    const column_headers = ["ID", name, status, "Category", "Started", "Duration"]
    for (const column_header of column_headers) { 
      await expect(this.page.getByRole('columnheader', { name: column_header, exact: true })).toBeVisible(); 
    }
  }

  async getPageUrl() {
    return this.page.url();
  }

  async gotoUrl(url = "") {
    await this.page.goto(url, { timeout: 120000 });
  }

  async waitForLoadState() {
    await this.page.waitForLoadState();
  }

  async waitForWorkflowStatus(status = "", timeout = 300000) {
    // await expect(this.page.getByText("Details")).toBeVisible();
    const statusRegex = RegExp(`Status ${status}`);
    await expect(this.page.getByText(statusRegex)).toBeVisible({
      timeout: timeout,
    });
  }

  async abortWorkflow() {
    await expect(
      this.page.getByRole("button", { name: "Abort" }),
    ).toBeEnabled();
    await this.page.getByRole("button", { name: "Abort" }).click();
    if (`${process.env.MILESTONE}` == "3") {
      await expect(
        this.page.getByRole("heading", { name: "Abort workflow", exact: true }),
      ).toBeVisible();
      await expect(
        this.page
          .locator("div")
          .filter({
            hasText:
              /^Are you sure you want to abort this workflow instance\?$/,
          })
          .first(),
      ).toBeVisible();
      await this.page.getByRole("button", { name: "Ok" }).click();
    } else {
      await expect(
        this.page
          .getByRole("dialog")
          .locator("div")
          .filter({ hasText: "Are you sure you want to" })
          .nth(2),
      ).toBeVisible();
      await this.page.getByRole("button", { name: "Abort" }).click();
    }
    await expect(this.page.getByText("Status Aborted")).toBeVisible();
    if (`${process.env.MILESTONE}` == "3") {
      await expect(
        this.page
          .locator("b")
          .filter({
            hasText:
              /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
          })
          .first(),
      ).toBeVisible();
    }
  }

  async validateErrorPopup() {
    await expect(
      this.page.getByRole("button", { name: "Error: Request failed with" }),
    ).toBeVisible();
    await this.page
      .getByRole("button", { name: "Error: Request failed with" })
      .click();
    // Here we can add an error validation check, when we have error messages that can
    // be validated, right now it is the same error for every issue
  }

  async validateErrorPopupDoesNotExist() {
    await expect(
      this.page.getByRole("button", { name: "Error: Request failed with" }),
    ).toHaveCount(0);
  }

  async resetWorkflow() {
    await this.page.getByRole("button", { name: "Reset" }).click();
  }
}
