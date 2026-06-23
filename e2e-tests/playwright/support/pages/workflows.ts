import { Page } from "@playwright/test";

const workflowsTable = (page: Page) =>
  page.getByRole("table").filter({ hasText: "Workflows" });

const WORKFLOWS = {
  workflowsTable,
};

export default WORKFLOWS;
