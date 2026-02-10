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
  async waitForWorkflowVisible(workflowName: string, timeout: number = 30000) {
    const workflowLink = this.page.getByRole("link", { name: workflowName });
    await expect(workflowLink).toBeVisible({ timeout });
  }

  async selectGreetingWorkflowItem(timeout: number = 30000) {
    const workflowHeader = this.page.getByRole("heading", {
      name: "Workflows",
    });
    await expect(workflowHeader).toBeVisible();
    await expect(workflowHeader).toHaveText("Workflows");
    await expect(Workflows.workflowsTable(this.page)).toBeVisible();
    // Wait for the workflow to be visible with explicit timeout for RBAC permission propagation
    const greetingLink = this.page.getByRole("link", {
      name: "Greeting workflow",
    });
    await expect(greetingLink).toBeVisible({ timeout });
    await greetingLink.click();
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
    await this.page
      .getByLabel("Status")
      .getByRole("button", { name: "All" })
      .click();

    const statuses = ["All", "Running", "Failed", "Completed", "Aborted"];
    for (const status of statuses) {
      await expect(this.page.getByRole("option", { name: status })).toHaveText(
        status,
      );
      await this.page.getByRole("option", { name: status }).click();
      await this.page
        .getByLabel("Status")
        .getByRole("button", { name: status })
        .click();
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

  async validateWorkflowAllRunsStatusIcons() {
    await this.page.getByRole("tab", { name: "all runs" }).click();
    const statuses = ["Running", "Failed", "Completed", "-- Aborted"];
    for (const status of statuses) {
      await expect(this.page.getByText(status).first()).toHaveText(status);
    }
    await expect(
      this.page
        .getByRole("cell", { name: /Running/ })
        .locator("svg")
        .first(),
    ).toBeVisible();
    await expect(
      this.page
        .getByRole("cell", { name: /Completed/ })
        .locator("svg")
        .first(),
    ).toBeVisible();
    await expect(
      this.page
        .getByRole("cell", { name: /Failed/ })
        .locator("svg")
        .first(),
    ).toBeVisible();
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
    await this.page
      .getByRole("dialog", { name: /Abort workflow run\?/i })
      .getByRole("button", { name: "Abort" })
      .click();
    await expect(this.page.getByText("Run has aborted")).toBeVisible();
    await expect(this.page.getByText("-- Aborted")).toBeVisible();
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

  async selectFailSwitchWorkflowItem(timeout: number = 30000) {
    const workflowHeader = this.page.getByRole("heading", {
      name: "Workflows",
    });
    await expect(workflowHeader).toBeVisible();
    await expect(workflowHeader).toHaveText("Workflows");
    await expect(Workflows.workflowsTable(this.page)).toBeVisible();
    // Wait for the workflow to be visible with explicit timeout for RBAC permission propagation
    const failSwitchLink = this.page.getByRole("link", {
      name: "FailSwitch workflow",
    });
    await expect(failSwitchLink).toBeVisible({ timeout });
    await failSwitchLink.click();
  }

  async runFailSwitchWorkflow(input = "OK") {
    const runButton = this.page.getByRole("button", { name: "Run" });
    await expect(runButton).toBeVisible();
    await runButton.click();
    await this.page.getByLabel(/switch/i).click();
    await this.page.getByRole("option", { name: input }).click();
    await this.page.getByRole("button", { name: "Next" }).click();
    await this.page.getByRole("button", { name: "Run" }).click();

    switch (input) {
      case "OK":
        await this.validateCurrentWorkflowStatus("Completed");
        break;
      case "KO":
        await this.validateCurrentWorkflowStatus("Failed");
        break;
      case "Wait":
        await this.validateCurrentWorkflowStatus("Running");
        break;
    }
  }

  async validateWorkflowStatusDetails(status = "Completed") {
    const details = this.page
      .getByRole("article")
      .filter({ has: this.page.getByRole("heading", { name: "Workflow" }) });

    if (status === "Running") {
      // Verify Run status heading and spinner in details area
      await expect(
        details.getByRole("heading", { name: /Run\s*status/i }),
      ).toBeVisible();
      await expect(
        this.page
          .locator("b")
          .filter({ hasText: "Running" })
          .getByRole("progressbar"),
      ).toBeVisible();
      // Verify a button shows 'Running' text and has a spinner
      const workflowButtons = this.page
        .locator("div")
        .filter({ hasText: "Abort Running..." })
        .nth(4);
      await expect(workflowButtons).toHaveText(/Running/i);
      await expect(workflowButtons.getByRole("progressbar")).toBeVisible();
      // Results section verifications
      await expect(
        this.page.getByTestId("info-card-subheader").getByRole("img"),
      ).toBeVisible();
      // Verify workflow is running message is visible with timestamp
      // Note: Following line is blocked in main branch due to bug RHDHBUGS-2220. TODO: Uncomment this once the bug is fixed.
      // await expect(this.page.getByText(/workflow is running\.?\s*Started at\s+\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)/i)).toBeVisible();
    }
    if (status === "Failed") {
      await expect(
        details.getByTestId("ErrorOutlineOutlinedIcon"),
      ).toBeVisible();
      await expect(
        this.page.getByText(
          /Run has failed at\s+\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)/,
        ),
      ).toBeVisible();
      await expect(
        this.page.getByTestId("ErrorOutlineOutlinedIcon"),
      ).toBeVisible();
    }
    if (status === "Completed") {
      await expect(
        this.page
          .locator("b")
          .filter({ hasText: "Completed" })
          .getByTestId("CheckCircleOutlinedIcon"),
      ).toBeVisible();
      await expect(
        this.page.getByText(
          /Run completed at\s+\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)/,
        ),
      ).toBeVisible();
      await expect(this.page.getByTestId("SuccessOutlinedIcon")).toBeVisible();
    }
  }

  async validateCurrentWorkflowStatus(status = "Completed", timeout = 120000) {
    await expect(this.page.getByText(`${status}`, { exact: true })).toBeVisible(
      {
        timeout,
      },
    );
  }

  async reRunFailSwitchWorkflow(input = "OK") {
    await expect(this.page.getByText("Run again")).toBeVisible();
    await this.page.getByText("Run again").click();
    await this.page.getByLabel("switch").click();
    await this.page.getByRole("option", { name: input }).click();
    await this.page.getByRole("button", { name: "Next" }).click();
    await this.page.getByRole("button", { name: "Run" }).click();
  }

  async reRunOnFailure(input = "Entire workflow") {
    await expect(this.page.getByText("Run again")).toBeVisible();
    await this.page.getByText("Run again").click();
    await this.page.getByRole("menuitem", { name: input }).click();
  }

  // Entity-Workflow Integration Methods (RHIDP-11833 through RHIDP-11840)

  async navigateToEntityWorkflowsTab(entityName: string) {
    await this.page.goto(`/catalog/default/component/${entityName}/workflows`, {
      timeout: 120000,
    });
    await this.page.waitForLoadState("load");
  }

  async verifyWorkflowsTabVisible() {
    const workflowsTab = this.page.getByRole("tab", { name: "Workflows" });
    await expect(workflowsTab).toBeVisible();
  }

  async verifyWorkflowsTabNotVisible() {
    const workflowsTab = this.page.getByRole("tab", { name: "Workflows" });
    await expect(workflowsTab).toHaveCount(0);
  }

  async verifyWorkflowInEntityTab(workflowName: string) {
    const workflowLink = this.page.getByRole("link", { name: workflowName });
    await expect(workflowLink).toBeVisible();
  }

  async verifyNoWorkflowsInEntityTab() {
    // Verify the workflows table is empty or shows "No workflows" message
    const noWorkflowsMessage = this.page.getByText(/no workflows/i);
    const emptyTable = this.page.locator("tbody").filter({ hasText: "" });
    await expect(noWorkflowsMessage.or(emptyTable.first())).toBeVisible();
  }

  async runWorkflowFromEntityTab(workflowName: string) {
    const workflowRow = this.page
      .getByRole("row")
      .filter({ hasText: workflowName });
    const runButton = workflowRow.getByRole("button", { name: "Run" });
    await expect(runButton).toBeVisible();
    await runButton.click();
  }

  async verifyBreadcrumbNavigation(entityName: string, workflowName: string) {
    // Verify breadcrumb contains entity name
    const breadcrumb = this.page.getByRole("navigation", {
      name: "Breadcrumb",
    });
    await expect(breadcrumb.getByText(entityName)).toBeVisible();

    // Click on entity in breadcrumb to navigate back
    await breadcrumb.getByText(entityName).click();
    await this.page.waitForLoadState("load");

    // Verify we're back on the entity page
    await expect(
      this.page.getByRole("heading", { name: entityName }),
    ).toBeVisible();
  }

  async clickWorkflowsTab() {
    await this.page.getByRole("tab", { name: "Workflows" }).click();
    await this.page.waitForLoadState("load");
  }

  async verifyOrchestratorCatalogTabCard() {
    // Verify the OrchestratorCatalogTab card is rendered
    const orchestratorCard = this.page.locator(
      '[data-testid="orchestrator-catalog-tab"]',
    );
    // If no testid, look for the card by its content
    const workflowsCard = this.page
      .getByRole("article")
      .filter({ has: this.page.getByText("Workflows") });
    await expect(orchestratorCard.or(workflowsCard.first())).toBeVisible();
  }
}
