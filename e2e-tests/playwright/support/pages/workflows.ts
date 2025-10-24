import { Page } from "@playwright/test";

const workflowsTable = (page: Page) =>
  page.locator("#root div").filter({ hasText: "Workflows" }).nth(2);

const WORKFLOWS = {
  workflowsTable,
};

export default WORKFLOWS;
