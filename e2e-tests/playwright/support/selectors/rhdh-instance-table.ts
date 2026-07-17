import { Page } from "@playwright/test";

import { SemanticSelectors } from "./semantic";

/** Table pagination helpers for RHDH instance catalog entity pages. */
export const RHDH_INSTANCE_TABLE = {
  getNextPageButton: (page: Page) => page.getByRole("button", { name: "Next Page" }),

  getPreviousPageButton: (page: Page) => page.getByRole("button", { name: "Previous Page" }),

  getLastPageButton: (page: Page) => page.getByRole("button", { name: "Last Page" }),

  getFirstPageButton: (page: Page) => page.getByRole("button", { name: "First Page" }),

  getTableRows: (page: Page) => SemanticSelectors.table(page).locator("tbody").getByRole("row"),

  getTableRow: (page: Page, text: string | RegExp) => SemanticSelectors.tableRow(page, text),
};
