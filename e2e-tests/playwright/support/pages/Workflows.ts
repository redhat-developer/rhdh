import { Page } from "@playwright/test";

const workflowsTable = (page: Page) =>
  page
    .locator("#root div")
    .filter({ hasText: "WorkflowsNameCategoryLast" })
    .nth(2);

const WORKFLOWS = {
  workflowsTable,
};

export default WORKFLOWS;
