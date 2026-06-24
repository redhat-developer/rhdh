import { semanticSelectorsAccessibility } from "./semantic-selectors-accessibility";
import { semanticSelectorsStructure } from "./semantic-selectors-structure";

/**
 * Semantic Selectors - Playwright Best Practices
 *
 * This object provides semantic locator methods following Playwright best practices.
 * Prefer these methods over CSS class selectors for more stable and maintainable tests.
 *
 * Priority Order:
 * 1. Role-based selectors (getByRole) - Preferred
 * 2. Label/Placeholder selectors (getByLabel, getByPlaceholder)
 * 3. Test ID selectors (getByTestId) - When semantic options not available
 * 4. CSS selectors (locator) - Last resort only
 *
 * @see https://playwright.dev/docs/locators
 * @see .cursor/rules/playwright-locators.mdc
 */
export const SemanticSelectors = {
  ...semanticSelectorsAccessibility,
  ...semanticSelectorsStructure,
};

export {
  findTableCell,
  findTableCellByColumn,
} from "./semantic-selectors-table-helpers";
