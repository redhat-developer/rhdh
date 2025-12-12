import { Page, Locator } from "@playwright/test";

/**
 * Semantic Selectors - Playwright Best Practices
 *
 * This class provides semantic locator methods following Playwright best practices.
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
export class SemanticSelectors {
  /**
   * Get a button by its accessible name
   * @param page - Playwright Page object
   * @param name - Button text or accessible name (supports regex)
   * @returns Locator for the button
   *
   * @example
   * await SemanticSelectors.button(page, 'Submit').click();
   * await SemanticSelectors.button(page, /save/i).click();
   */
  static button(page: Page, name: string | RegExp): Locator {
    return page.getByRole("button", { name });
  }

  /**
   * Get a link by its accessible name
   * @param page - Playwright Page object
   * @param name - Link text or accessible name (supports regex)
   * @returns Locator for the link
   *
   * @example
   * await SemanticSelectors.link(page, 'View Details').click();
   */
  static link(page: Page, name: string | RegExp): Locator {
    return page.getByRole("link", { name });
  }

  /**
   * Get a table element
   * @param page - Playwright Page object
   * @returns Locator for the table
   *
   * @example
   * const table = SemanticSelectors.table(page);
   * const rows = table.getByRole('row');
   */
  static table(page: Page): Locator {
    return page.getByRole("table");
  }

  /**
   * Get a table cell by its accessible name or content
   * @param page - Playwright Page object
   * @param text - Cell text content (optional, supports regex)
   * @returns Locator for the cell(s)
   *
   * @example
   * await expect(SemanticSelectors.tableCell(page, 'Active')).toBeVisible();
   */
  static tableCell(page: Page, text?: string | RegExp): Locator {
    return text
      ? page.getByRole("cell", { name: text })
      : page.getByRole("cell");
  }

  /**
   * Get a table column header
   * @param page - Playwright Page object
   * @param name - Column header text
   * @returns Locator for the column header
   *
   * @example
   * await SemanticSelectors.tableHeader(page, 'Created At').click();
   */
  static tableHeader(page: Page, name: string | RegExp): Locator {
    return page.getByRole("columnheader", { name });
  }

  /**
   * Get a table row by content
   * @param page - Playwright Page object
   * @param text - Row content to filter by (optional)
   * @returns Locator for the row(s)
   *
   * @example
   * const row = SemanticSelectors.tableRow(page, 'Guest User');
   * await row.getByRole('button', { name: 'Edit' }).click();
   */
  static tableRow(page: Page, text?: string | RegExp): Locator {
    const rows = page.getByRole("row");
    return text ? rows.filter({ hasText: text }) : rows;
  }

  /**
   * Get a heading by level and text
   * @param page - Playwright Page object
   * @param name - Heading text (supports regex)
   * @param level - Heading level (1-6, optional)
   * @returns Locator for the heading
   *
   * @example
   * await expect(SemanticSelectors.heading(page, 'RBAC', 1)).toBeVisible();
   * await expect(SemanticSelectors.heading(page, /settings/i)).toBeVisible();
   */
  static heading(
    page: Page,
    name: string | RegExp,
    level?: 1 | 2 | 3 | 4 | 5 | 6,
  ): Locator {
    return page.getByRole("heading", { name, level });
  }

  /**
   * Get a text input by label
   * @param page - Playwright Page object
   * @param label - Input label text
   * @returns Locator for the input
   *
   * @example
   * await SemanticSelectors.inputByLabel(page, 'Email address').fill('user@example.com');
   */
  static inputByLabel(page: Page, label: string | RegExp): Locator {
    return page.getByLabel(label);
  }

  /**
   * Get an input by placeholder
   * @param page - Playwright Page object
   * @param placeholder - Placeholder text
   * @returns Locator for the input
   *
   * @example
   * await SemanticSelectors.inputByPlaceholder(page, 'Search...').fill('test');
   */
  static inputByPlaceholder(page: Page, placeholder: string | RegExp): Locator {
    return page.getByPlaceholder(placeholder);
  }

  /**
   * Get a checkbox by label
   * @param page - Playwright Page object
   * @param label - Checkbox label text
   * @returns Locator for the checkbox
   *
   * @example
   * await SemanticSelectors.checkbox(page, 'Accept terms').check();
   */
  static checkbox(page: Page, label: string | RegExp): Locator {
    return page.getByRole("checkbox", { name: label });
  }

  /**
   * Get a radio button by label
   * @param page - Playwright Page object
   * @param label - Radio button label text
   * @returns Locator for the radio button
   *
   * @example
   * await SemanticSelectors.radio(page, 'Option A').check();
   */
  static radio(page: Page, label: string | RegExp): Locator {
    return page.getByRole("radio", { name: label });
  }

  /**
   * Get a dialog/modal
   * @param page - Playwright Page object
   * @param name - Dialog name/title (optional)
   * @returns Locator for the dialog
   *
   * @example
   * const dialog = SemanticSelectors.dialog(page, 'Confirm Delete');
   * await dialog.getByRole('button', { name: 'OK' }).click();
   */
  static dialog(page: Page, name?: string | RegExp): Locator {
    return name ? page.getByRole("dialog", { name }) : page.getByRole("dialog");
  }

  /**
   * Get a navigation element
   * @param page - Playwright Page object
   * @param name - Navigation name (optional)
   * @returns Locator for the navigation
   *
   * @example
   * const nav = SemanticSelectors.navigation(page);
   * await nav.getByRole('link', { name: 'Home' }).click();
   */
  static navigation(page: Page, name?: string | RegExp): Locator {
    return name
      ? page.getByRole("navigation", { name })
      : page.getByRole("navigation");
  }

  /**
   * Get a banner (header) element
   * @param page - Playwright Page object
   * @returns Locator for the banner
   *
   * @example
   * const header = SemanticSelectors.banner(page);
   * await expect(header).toContainText('Welcome');
   */
  static banner(page: Page): Locator {
    return page.getByRole("banner");
  }

  /**
   * Get a main content area
   * @param page - Playwright Page object
   * @returns Locator for the main content
   *
   * @example
   * const main = SemanticSelectors.main(page);
   * await expect(main.getByRole('heading')).toBeVisible();
   */
  static main(page: Page): Locator {
    return page.getByRole("main");
  }

  /**
   * Get a tab by name
   * @param page - Playwright Page object
   * @param name - Tab name/text
   * @returns Locator for the tab
   *
   * @example
   * await SemanticSelectors.tab(page, 'Settings').click();
   */
  static tab(page: Page, name: string | RegExp): Locator {
    return page.getByRole("tab", { name });
  }

  /**
   * Get a menu item
   * @param page - Playwright Page object
   * @param name - Menu item text
   * @returns Locator for the menu item
   *
   * @example
   * await SemanticSelectors.menuItem(page, 'Delete').click();
   */
  static menuItem(page: Page, name: string | RegExp): Locator {
    return page.getByRole("menuitem", { name });
  }

  /**
   * Get a list (ul/ol) element
   * @param page - Playwright Page object
   * @param name - List accessible name (optional)
   * @returns Locator for the list
   *
   * @example
   * const list = SemanticSelectors.list(page);
   * const items = list.getByRole('listitem');
   */
  static list(page: Page, name?: string | RegExp): Locator {
    return name ? page.getByRole("list", { name }) : page.getByRole("list");
  }

  /**
   * Get a list item
   * @param page - Playwright Page object
   * @param text - List item content to filter by (optional)
   * @returns Locator for the list item(s)
   *
   * @example
   * await SemanticSelectors.listItem(page, 'Product 1').click();
   */
  static listItem(page: Page, text?: string | RegExp): Locator {
    const items = page.getByRole("listitem");
    return text ? items.filter({ hasText: text }) : items;
  }

  /**
   * Get an article element
   * @param page - Playwright Page object
   * @returns Locator for the article
   *
   * @example
   * const article = SemanticSelectors.article(page);
   * await expect(article.getByRole('link')).toBeVisible();
   */
  static article(page: Page): Locator {
    return page.getByRole("article");
  }

  /**
   * Get a region (section with accessible name)
   * @param page - Playwright Page object
   * @param name - Region accessible name (optional)
   * @returns Locator for the region
   *
   * @example
   * const sidebar = SemanticSelectors.region(page, 'Sidebar');
   * await sidebar.getByRole('button', { name: 'Filter' }).click();
   */
  static region(page: Page, name?: string | RegExp): Locator {
    return name ? page.getByRole("region", { name }) : page.getByRole("region");
  }

  /**
   * Get an alert element
   * @param page - Playwright Page object
   * @param name - Alert text/name (optional)
   * @returns Locator for the alert
   *
   * @example
   * await expect(SemanticSelectors.alert(page, 'Error')).toBeVisible();
   */
  static alert(page: Page, name?: string | RegExp): Locator {
    return name ? page.getByRole("alert", { name }) : page.getByRole("alert");
  }

  /**
   * Get an element by test ID (fallback when semantic selectors not available)
   * @param page - Playwright Page object
   * @param testId - data-testid attribute value
   * @returns Locator for the element
   *
   * @example
   * await SemanticSelectors.testId(page, 'custom-component').click();
   */
  static testId(page: Page, testId: string): Locator {
    return page.getByTestId(testId);
  }

  /**
   * Get an element by alt text (for images)
   * @param page - Playwright Page object
   * @param altText - Image alt text
   * @returns Locator for the image
   *
   * @example
   * await expect(SemanticSelectors.image(page, 'Logo')).toBeVisible();
   */
  static image(page: Page, altText: string | RegExp): Locator {
    return page.getByAltText(altText);
  }

  /**
   * Get an element by title attribute
   * @param page - Playwright Page object
   * @param title - Title attribute value
   * @returns Locator for the element
   *
   * @example
   * await SemanticSelectors.title(page, 'Close').click();
   */
  static title(page: Page, title: string | RegExp): Locator {
    return page.getByTitle(title);
  }

  /**
   * Scope a locator to a specific container using semantic selector
   * @param container - Parent locator to scope within
   * @param role - Role of the element to find
   * @param name - Accessible name (optional)
   * @returns Scoped locator
   *
   * @example
   * const dialog = page.getByRole('dialog');
   * const button = SemanticSelectors.scopedByRole(dialog, 'button', 'OK');
   * await button.click();
   */
  static scopedByRole(
    container: Locator,
    role:
      | "button"
      | "link"
      | "heading"
      | "textbox"
      | "cell"
      | "row"
      | "columnheader"
      | "tab"
      | "menuitem"
      | "listitem",
    name?: string | RegExp,
  ): Locator {
    return name
      ? container.getByRole(role, { name })
      : container.getByRole(role);
  }
}

/**
 * Helper to find table row by unique text and get specific cell
 * @param page - Playwright Page object
 * @param rowText - Unique text to identify the row
 * @param cellIndex - Index of the cell to get (0-based)
 * @returns Locator for the specific cell in the row
 *
 * @example
 * const createdAtCell = findTableCell(page, 'timestamp-test', 7);
 * await expect(createdAtCell).toHaveText(/\d{1,2}\/\d{1,2}\/\d{4}/);
 */
export function findTableCell(
  page: Page,
  rowText: string | RegExp,
  cellIndex: number,
): Locator {
  const row = SemanticSelectors.tableRow(page, rowText);
  return row.getByRole("cell").nth(cellIndex);
}

/**
 * Helper to find table cell by column header name
 * @param page - Playwright Page object
 * @param rowText - Unique text to identify the row
 * @param columnName - Column header name
 * @returns Locator for the cell
 *
 * @example
 * const statusCell = await findTableCellByColumn(page, 'Guest User', 'Status');
 * await expect(statusCell).toHaveText('Active');
 */
export async function findTableCellByColumn(
  page: Page,
  rowText: string | RegExp,
  columnName: string | RegExp,
): Promise<Locator> {
  const header = SemanticSelectors.tableHeader(page, columnName);
  const columnIndex = await header.evaluate(
    (th: HTMLTableCellElement) => th.cellIndex,
  );
  return findTableCell(page, rowText, columnIndex);
}

/**
 * Wait strategies - Prefer these over waitForTimeout
 *
 * Note: For element visibility/hidden states, prefer using expect() assertions:
 * - await expect(locator).toBeVisible() - Auto-waits for visibility
 * - await expect(locator).toBeHidden() - Auto-waits for hidden state
 *
 * These methods are only for specialized waiting scenarios.
 *
 * ⚠️ networkidle removed: Not recommended by Playwright as it doesn't wait for
 * requests triggered after load and can give false positives with polling.
 * Use forAPIResponse() or expect() assertions instead.
 */
export class WaitStrategies {
  /**
   * Wait for DOM content to be loaded
   */
  static async forDOMContentLoaded(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
  }

  /**
   * Wait for specific API response
   */
  static async forAPIResponse(
    page: Page,
    urlPattern: string | RegExp,
    statusCode: number = 200,
  ): Promise<void> {
    await page.waitForResponse((response) => {
      const url = response.url();
      const matchesUrl =
        typeof urlPattern === "string"
          ? url.includes(urlPattern)
          : urlPattern.test(url);
      return matchesUrl && response.status() === statusCode;
    });
  }
}
