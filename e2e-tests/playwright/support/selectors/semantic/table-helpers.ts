import { Page } from "@playwright/test";

import { semanticSelectorsAccessibility } from "./accessibility";

/** Zero-based position of the column whose header matches `columnName`. */
export function findColumnIndex(page: Page, columnName: string | RegExp): Promise<number> {
  const header = semanticSelectorsAccessibility.tableHeader(page, columnName);
  return header.evaluate((th: HTMLTableCellElement) => th.cellIndex);
}
