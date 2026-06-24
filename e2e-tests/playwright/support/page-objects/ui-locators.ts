/* oxlint-disable playwright/no-raw-locators -- legacy card/table region selectors pending SemanticSelectors migration */
import { Locator, Page } from "@playwright/test";

import { SemanticSelectors } from "../selectors/semantic-selectors";

export function getCardByHeading(page: Page, heading: string | RegExp): Locator {
  return page
    .locator('[role="region"], article, section')
    .filter({
      has: page.getByRole("heading", { name: heading }),
    })
    .first();
}

export function getCardByText(page: Page, text: string | RegExp): Locator {
  return page
    .locator('[role="region"], article, section')
    .filter({
      hasText: text,
    })
    .first();
}

export const getTableCell = (page: Page, text?: string | RegExp): Locator =>
  SemanticSelectors.tableCell(page, text);

export const getTableRow = (page: Page, text?: string | RegExp): Locator =>
  SemanticSelectors.tableRow(page, text);
