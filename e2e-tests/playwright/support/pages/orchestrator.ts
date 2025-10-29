import { expect, type Page } from "@playwright/test";
import Workflows from "./workflows";

export class Orchestrator {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async openWorkflowAlert() {
    // This is only valid for MILESTONE 2
    const alert = this.page.getByRole("alert");
    await alert.getByRole("button").nth(0).click();
  }

  async closeWorkflowAlert() {
    await this.page.getByRole("alert").getByRole("button").nth(2).click();
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
    const runButton = this.page.getByRole("button", { name: "Run" });
    await expect(runButton).toBeVisible();
    await runButton.click();
    await this.page.getByLabel("Language").click();
    await this.page.getByRole("option", { name: language }).click();
    await this.page.getByRole("button", { name: "Next" }).click();
    await this.page.getByRole("button", { name: "Run" }).click();
    await expect(this.page.getByText(`${status}`, { exact: true })).toBeVisible(
      {
        timeout: 600000,
      },
    );
  }

  async reRunGreetingWorkflow(language = "English", status = "Completed") {
    await expect(this.page.getByText("Run again")).toBeVisible();
    await this.page.getByText("Run again").click();
    await this.page.getByLabel("Language").click();
    await this.page.getByRole("option", { name: language }).click();
    await this.page.getByRole("button", { name: "Next" }).click();
    await this.page.getByRole("button", { name: "Run" }).click();
    await expect(this.page.getByText(`${status}`, { exact: true })).toBeVisible(
      {
        timeout: 600000,
      },
    );
  }

  async validateGreetingWorkflow() {
    await this.page.getByRole("tab", { name: "Workflows" }).click();
    const workflowHeader = this.page.getByRole("heading", {
      name: "Workflows",
    });
    await expect(workflowHeader).toBeVisible();
    await expect(workflowHeader).toHaveText("Workflows");
    await expect(Workflows.workflowsTable(this.page)).toBeVisible();
    await expect(
      this.page.locator(`input[aria-label="Search"]`),
    ).toHaveAttribute("placeholder", "Filter");
    await expect(
      this.page.getByRole("columnheader", { name: "Name", exact: true }),
    ).toBeVisible();
    await expect(
      this.page.getByRole("columnheader", {
        name: "Workflow Status",
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      this.page.getByRole("columnheader", { name: "Last run", exact: true }),
    ).toBeVisible();
    await expect(
      this.page.getByRole("columnheader", {
        name: "Last run status",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      this.page.getByRole("columnheader", { name: "Actions", exact: true }),
    ).toBeVisible();
    const workFlowRow = this.page.locator(`tr:has-text("Greeting workflow")`);
    await expect(workFlowRow.locator("td").nth(0)).toHaveText(
      "Greeting workflow",
    );
    await expect(workFlowRow.locator("td").nth(1)).toHaveText("Available");
    await expect(workFlowRow.locator("td").nth(2)).toHaveText(
      /^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{1,2}:\d{1,2} (AM|PM)$/,
    );
    await expect(workFlowRow.locator("td").nth(3)).toHaveText("Completed");
    await expect(workFlowRow.locator("td").nth(4)).toHaveText(
      "YAML based greeting workflow",
    );
    await expect(
      workFlowRow.getByRole("button", { name: "Run", exact: true }).first(),
    ).toBeVisible();
    await expect(
      workFlowRow.getByRole("button", { name: "View runs" }).first(),
    ).toBeVisible();
    await expect(
      workFlowRow.getByRole("button", { name: "View input schema" }).first(),
    ).toBeVisible();
  }

  async validateWorkflowRunsDetails() {
    await expect(this.page.getByText("Details")).toBeVisible();
    await expect(this.page.getByText("Results")).toBeVisible();
    await expect(this.page.getByText("Workflow progress")).toBeVisible();
    await expect(
      this.page.locator("div").filter({ hasText: "Completed" }).first(),
    ).toBeVisible();
  }

  async validateWorkflowAllRuns() {
    await this.page.getByRole("tab", { name: "all runs" }).click();
    await expect(
      this.page
        .locator("tbody")
        .getByRole("row")
        .nth(0)
        .getByRole("cell")
        .nth(0),
    ).toBeVisible();
    await expect(this.page.getByTestId("select").first()).toHaveAttribute(
      "aria-label",
      "Status",
    );
    await this.page.getByTestId("select").first().click();

    const statuses = ["All", "Running", "Failed", "Completed", "Aborted"];
    for (const status of statuses) {
      await expect(this.page.getByRole("option", { name: status })).toHaveText(
        status,
      );
    }
    await this.page.getByRole("option", { name: "All" }).click();

    const columnHeaders = [
      "ID",
      "Workflow name",
      "Run Status",
      "Started",
      "Duration",
    ];
    for (const columnHeader of columnHeaders) {
      await expect(
        this.page.getByRole("columnheader", {
          name: columnHeader,
          exact: true,
        }),
      ).toBeVisible();
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
    await expect(
      this.page
        .getByRole("dialog")
        .locator("div")
        .filter({ hasText: "Are you sure you want to" })
        .nth(2),
    ).toBeVisible();
    await this.page.getByRole("button", { name: "Abort" }).click();
    await expect(this.page.getByText("Status Aborted")).toBeVisible();
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
