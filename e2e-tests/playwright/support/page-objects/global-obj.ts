import { Page, Locator } from "@playwright/test";
import { SemanticSelectors } from "../selectors/semantic-selectors";

/**
 * WAIT_OBJECTS - Loading indicators
 * @deprecated These MUI class selectors are fragile. Consider using SemanticSelectors or expect() assertions instead.
 */
export const WAIT_OBJECTS = {
  /** @deprecated Use expect(locator).not.toBeVisible() for loading indicators */
  MuiLinearProgress: 'div[class*="MuiLinearProgress-root"]',
  /** @deprecated Use expect(locator).not.toBeVisible() for loading indicators */
  MuiCircularProgress: '[class*="MuiCircularProgress-root"]',
};

/**
 * UI_HELPER_ELEMENTS - Legacy MUI class selectors
 * @deprecated These selectors are based on MUI implementation details and can break with UI library updates.
 *
 * Migration Guide:
 * - MuiButtonLabel -> Use SemanticSelectors.button(page, 'Button Name') or getButton() method below
 * - MuiTableCell -> Use SemanticSelectors.tableCell(page, 'Cell Text') or getTableCell() method
 * - MuiTableHead -> Use SemanticSelectors.tableHeader(page, 'Column Name') or getTableHeader() method
 *
 * New code should use SemanticSelectors class or the get*() methods below.
 */
export const UI_HELPER_ELEMENTS = {
  // ========================================
  // LEGACY SELECTORS - Maintained for backward compatibility
  // These will be removed in a future phase after all tests are migrated
  // ========================================

  /** @deprecated Use SemanticSelectors.button(page, name) or getButton() */
  MuiButtonLabel:
    'span[class^="MuiButton-label"],button[class*="MuiButton-root"]',
  /** @deprecated Use SemanticSelectors.button(page, name) with filter */
  MuiToggleButtonLabel: 'span[class^="MuiToggleButton-label"]',
  /** @deprecated Use SemanticSelectors.inputByLabel(page, label) */
  MuiBoxLabel: 'div[class*="MuiBox-root"] label',
  /** @deprecated Use SemanticSelectors.tableHeader(page, name) or getTableHeader() */
  MuiTableHead: 'th[class*="MuiTableCell-root"]',
  /** @deprecated Use SemanticSelectors.tableCell(page, text) or getTableCell() */
  MuiTableCell: 'td[class*="MuiTableCell-root"]',
  /** @deprecated Use SemanticSelectors.tableRow(page, text) or getTableRow() */
  MuiTableRow: 'tr[class*="MuiTableRow-root"]',
  /** @deprecated Use semantic selectors with appropriate styling checks */
  MuiTypographyColorPrimary: ".MuiTypography-colorPrimary",
  /** @deprecated Use SemanticSelectors.checkbox() with appropriate checks */
  MuiSwitchColorPrimary: ".MuiSwitch-colorPrimary",
  /** @deprecated Use SemanticSelectors.button(page, name) */
  MuiButtonTextPrimary: ".MuiButton-textPrimary",
  /** @deprecated Use getCardByHeading() method or SemanticSelectors.region().filter() */
  MuiCard: (cardHeading: string) =>
    `//div[contains(@class,'MuiCardHeader-root') and descendant::*[text()='${cardHeading}']]/..`,
  /** @deprecated Use getCardByText() method or SemanticSelectors.region().filter() */
  MuiCardRoot: (cardText: string) =>
    `//div[contains(@class,'MuiCard-root')][descendant::text()[contains(., '${cardText}')]]`,
  /** @deprecated Use SemanticSelectors.table(page) or getTable() */
  MuiTable: "table.MuiTable-root",
  /** @deprecated Use SemanticSelectors.region().filter() for card headers */
  MuiCardHeader: 'div[class*="MuiCardHeader-root"]',
  /** @deprecated Use SemanticSelectors.inputByPlaceholder() or inputByLabel() */
  MuiInputBase: 'div[class*="MuiInputBase-root"]',
  /** @deprecated Use appropriate semantic selector based on element role */
  MuiTypography: 'span[class*="MuiTypography-root"]',
  /** @deprecated Use SemanticSelectors.alert(page, name) */
  MuiAlert: 'div[class*="MuiAlert-message"]',
  /** ✅ This is already semantic, but prefer SemanticSelectors.tab(page, name) */
  tabs: '[role="tab"]',
  /** @deprecated Use SemanticSelectors.tableRow(page, text) */
  rowByText: (text: string) => `tr:has(:text-is("${text}"))`,

  // ========================================
  // NEW SEMANTIC METHODS - Preferred approach
  // Use these for new code and when refactoring
  // ========================================

  /**
   * Get a button by its accessible name
   * ✅ Preferred over MuiButtonLabel
   * @example UI_HELPER_ELEMENTS.getButton(page, 'Submit').click()
   */
  getButton: (page: Page, name: string | RegExp): Locator =>
    SemanticSelectors.button(page, name),

  /**
   * Get a link by its accessible name
   * ✅ Preferred for navigation elements
   * @example UI_HELPER_ELEMENTS.getLink(page, 'View Details').click()
   */
  getLink: (page: Page, name: string | RegExp): Locator =>
    SemanticSelectors.link(page, name),

  /**
   * Get a table element
   * ✅ Preferred over MuiTable
   * @example const table = UI_HELPER_ELEMENTS.getTable(page)
   */
  getTable: (page: Page): Locator => SemanticSelectors.table(page),

  /**
   * Get a table cell by content
   * ✅ Preferred over MuiTableCell
   * @example UI_HELPER_ELEMENTS.getTableCell(page, 'Active')
   */
  getTableCell: (page: Page, text?: string | RegExp): Locator =>
    SemanticSelectors.tableCell(page, text),

  /**
   * Get a table header (column header)
   * ✅ Preferred over MuiTableHead
   * @example UI_HELPER_ELEMENTS.getTableHeader(page, 'Created At').click()
   */
  getTableHeader: (page: Page, name: string | RegExp): Locator =>
    SemanticSelectors.tableHeader(page, name),

  /**
   * Get a table row by content
   * ✅ Preferred over MuiTableRow and rowByText
   * @example const row = UI_HELPER_ELEMENTS.getTableRow(page, 'Guest User')
   */
  getTableRow: (page: Page, text?: string | RegExp): Locator =>
    SemanticSelectors.tableRow(page, text),

  /**
   * Get a heading by text and optional level
   * @example UI_HELPER_ELEMENTS.getHeading(page, 'RBAC', 1)
   */
  getHeading: (
    page: Page,
    name: string | RegExp,
    level?: 1 | 2 | 3 | 4 | 5 | 6,
  ): Locator => SemanticSelectors.heading(page, name, level),

  /**
   * Get a tab by name
   * ✅ Preferred over tabs selector
   * @example UI_HELPER_ELEMENTS.getTab(page, 'Settings').click()
   */
  getTab: (page: Page, name: string | RegExp): Locator =>
    SemanticSelectors.tab(page, name),

  /**
   * Get a dialog/modal
   * @example const dialog = UI_HELPER_ELEMENTS.getDialog(page, 'Confirm Delete')
   */
  getDialog: (page: Page, name?: string | RegExp): Locator =>
    SemanticSelectors.dialog(page, name),

  /**
   * Get a card by heading text (semantic alternative to MuiCard)
   * ✅ Preferred over MuiCard XPath selector
   * @example const card = UI_HELPER_ELEMENTS.getCardByHeading(page, 'RHDH Build info')
   */
  getCardByHeading: (page: Page, heading: string | RegExp): Locator => {
    // Find region or article containing the heading
    return page
      .locator('[role="region"], article, section')
      .filter({
        has: page.getByRole("heading", { name: heading }),
      })
      .first();
  },

  /**
   * Get a card by text content (semantic alternative to MuiCardRoot)
   * ✅ Preferred over MuiCardRoot XPath selector
   * @example const card = UI_HELPER_ELEMENTS.getCardByText(page, 'Context one')
   */
  getCardByText: (page: Page, text: string | RegExp): Locator => {
    return page
      .locator('[role="region"], article, section')
      .filter({
        hasText: text,
      })
      .first();
  },

  /**
   * Get an input by label
   * ✅ Preferred over MuiInputBase
   * @example UI_HELPER_ELEMENTS.getInputByLabel(page, 'Email').fill('test@example.com')
   */
  getInputByLabel: (page: Page, label: string | RegExp): Locator =>
    SemanticSelectors.inputByLabel(page, label),

  /**
   * Get an input by placeholder
   * ✅ Preferred over MuiInputBase
   * @example UI_HELPER_ELEMENTS.getInputByPlaceholder(page, 'Search...').fill('test')
   */
  getInputByPlaceholder: (page: Page, placeholder: string | RegExp): Locator =>
    SemanticSelectors.inputByPlaceholder(page, placeholder),

  /**
   * Get an alert element
   * ✅ Preferred over MuiAlert
   * @example await expect(UI_HELPER_ELEMENTS.getAlert(page, 'Error')).toBeVisible()
   */
  getAlert: (page: Page, name?: string | RegExp): Locator =>
    SemanticSelectors.alert(page, name),

  /**
   * Get navigation element
   * @example const nav = UI_HELPER_ELEMENTS.getNavigation(page)
   */
  getNavigation: (page: Page, name?: string | RegExp): Locator =>
    SemanticSelectors.navigation(page, name),

  /**
   * Get menu item
   * @example UI_HELPER_ELEMENTS.getMenuItem(page, 'Delete').click()
   */
  getMenuItem: (page: Page, name: string | RegExp): Locator =>
    SemanticSelectors.menuItem(page, name),
};
