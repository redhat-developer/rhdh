/* oxlint-disable playwright/no-raw-locators -- legacy card/table region selectors pending SemanticSelectors migration */
import { Locator, Page } from "@playwright/test";

import { SemanticSelectors } from "../selectors/semantic";
import { UI_HELPER_ELEMENTS } from "./global-obj";

export function getCardByHeading(page: Page, heading: string | RegExp): Locator {
  if (typeof heading === "string") {
    /* oxlint-disable-next-line typescript/no-deprecated -- MUI cards lack region/heading roles; XPath matches production DOM */
    return page.locator(UI_HELPER_ELEMENTS.MuiCard(heading));
  }
  return page
    .locator('[role="region"], article, section')
    .filter({
      has: page.getByRole("heading", { name: heading }),
    })
    .first();
}

export function getCardByText(page: Page, text: string | RegExp): Locator {
  if (typeof text === "string") {
    /* oxlint-disable-next-line typescript/no-deprecated -- MUI cards lack region roles; XPath matches production DOM */
    return page.locator(UI_HELPER_ELEMENTS.MuiCardRoot(text));
  }
  return page
    .locator('[role="region"], article, section')
    .filter({
      hasText: text,
    })
    .first();
}

export const getTableCell = (page: Page, text?: string | RegExp): Locator =>
  SemanticSelectors.tableCell(page, text);

export function getTableRow(page: Page, text?: string | RegExp): Locator {
  if (text === undefined) {
    return SemanticSelectors.tableRow(page);
  }
  if (typeof text === "string") {
    /* oxlint-disable-next-line typescript/no-deprecated -- :text-is() avoids ambiguous hasText row matches in review tables */
    return page.locator(UI_HELPER_ELEMENTS.rowByText(text));
  }
  return SemanticSelectors.tableRow(page, text);
}
