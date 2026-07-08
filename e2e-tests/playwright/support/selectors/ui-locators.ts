/* oxlint-disable playwright/no-raw-locators -- legacy card/table region selectors pending SemanticSelectors migration */
import { Locator, Page } from "@playwright/test";

import { SemanticSelectors } from "./semantic";

const legacyRowByText = (text: string) => `tr:has(:text-is("${text}"))`;

export function getTableRow(page: Page, text?: string | RegExp): Locator {
  if (text === undefined) {
    return SemanticSelectors.tableRow(page);
  }
  if (typeof text === "string") {
    /* oxlint-disable-next-line typescript/no-deprecated -- :text-is() avoids ambiguous hasText row matches in review tables */
    return page.locator(legacyRowByText(text));
  }
  return SemanticSelectors.tableRow(page, text);
}
