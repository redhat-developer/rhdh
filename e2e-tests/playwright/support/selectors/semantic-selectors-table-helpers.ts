import { Page, Locator } from "@playwright/test";
import { semanticSelectorsAccessibility } from "./semantic-selectors-accessibility";

export function findTableCell(
  page: Page,
  rowText: string | RegExp,
  cellIndex: number,
): Locator {
  const row = semanticSelectorsAccessibility.tableRow(page, rowText);
  return row.getByRole("cell").nth(cellIndex);
}

export async function findTableCellByColumn(
  page: Page,
  rowText: string | RegExp,
  columnName: string | RegExp,
): Promise<Locator> {
  const header = semanticSelectorsAccessibility.tableHeader(page, columnName);
  const columnIndex = await header.evaluate(
    (th: HTMLTableCellElement) => th.cellIndex,
  );
  return findTableCell(page, rowText, columnIndex);
}
