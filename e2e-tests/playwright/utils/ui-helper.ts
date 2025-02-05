import { expect, Locator, Page } from "@playwright/test";
import { UI_HELPER_ELEMENTS } from "../support/pageObjects/global-obj";
import { SidebarTabs } from "./navbar";

export class UiHelper {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async verifyComponentInCatalog(kind: string, expectedRows: string[]) {
    await this.openSidebar("Catalog");
    await this.selectMuiBox("Kind", kind);
    await this.verifyRowsInTable(expectedRows);
  }

  getSideBarMenuItem(menuItem: string): Locator {
    return this.page.getByTestId("login-button").getByText(menuItem);
  }

  async fillTextInputByLabel(label: string, text: string) {
    await this.page.getByLabel(label).fill(text);
  }

  /**
   * Fills the search input with the provided text.
   *
   * @param searchText - The text to be entered into the search input field.
   */
  async searchInputPlaceholder(searchText: string) {
    await this.page.fill('input[placeholder="Search"]', searchText);
  }

  async filterInputPlaceholder(searchText: string) {
    await this.page.fill('input[placeholder="Filter"]', searchText);
  }

  async pressTab() {
    await this.page.keyboard.press("Tab");
  }

  async checkCheckbox(text: string) {
    const locator = this.page.getByRole("checkbox", {
      name: text,
    });
    await locator.check();
  }

  async clickButton(
    label: string | RegExp,
    options: { exact?: boolean; force?: boolean } = {
      exact: true,
      force: false,
    },
  ) {
    const selector = `${UI_HELPER_ELEMENTS.MuiButtonLabel}`;
    const button = this.page
      .locator(selector)
      .getByText(label, { exact: options.exact })
      .first();

    if (options?.force) {
      await button.click({ force: true });
    } else {
      await button.click();
    }
    return button;
  }

  async clickBtnByTitleIfNotPressed(title: string) {
    const button = this.page.locator(`button[title="${title}"]`);
    const isPressed = await button.getAttribute("aria-pressed");

    if (isPressed === "false") {
      await button.click();
    }
  }

  async clickByDataTestId(dataTestId: string) {
    const element = this.page.getByTestId(dataTestId);
    await element.waitFor({ state: "visible" });
    await element.click();
  }

  async verifyDivHasText(divText: string | RegExp) {
    await expect(this.page.locator(`div`).getByText(divText)).toBeVisible();
  }

  async clickLink(linkText: string) {
    await this.page.locator(`a`).filter({ hasText: linkText }).first().click();
  }

  async verifyLink(
    linkText: string,
    options: {
      exact?: boolean;
      notVisible?: boolean;
    } = {
      exact: true,
      notVisible: false,
    },
  ) {
    const linkLocator = this.page
      .locator("a")
      .getByText(linkText, { exact: options.exact })
      .first();

    if (options?.notVisible) {
      await expect(linkLocator).not.toBeVisible();
    } else {
      await expect(linkLocator).toBeVisible();
    }
  }

  private async isElementVisible(
    locator: string,
    timeout = 10000,
    force = false,
  ): Promise<boolean> {
    try {
      await this.page.waitForSelector(locator, {
        state: "visible",
        timeout: timeout,
      });
      const button = this.page.locator(locator).first();
      return button.isVisible();
    } catch (error) {
      if (force) throw error;
      return false;
    }
  }

  async isBtnVisibleByTitle(text: string): Promise<boolean> {
    const locator = `BUTTON[title="${text}"]`;
    return await this.isElementVisible(locator);
  }

  async isBtnVisible(text: string): Promise<boolean> {
    const locator = `button:has-text("${text}")`;
    return await this.isElementVisible(locator);
  }

  async isTextVisible(text: string, timeout = 10000): Promise<boolean> {
    const locator = `:has-text("${text}")`;
    return await this.isElementVisible(locator, timeout);
  }

  async isLinkVisible(text: string): Promise<boolean> {
    const locator = `a:has-text("${text}")`;
    return await this.isElementVisible(locator);
  }

  async waitForSideBarVisible() {
    await this.page.waitForSelector("nav a", { timeout: 10_000 });
  }

  async openSidebar(navBarText: SidebarTabs) {
    const navLink = this.page
      .locator(`nav a:has-text("${navBarText}")`)
      .first();
    await navLink.waitFor({ state: "visible" });
    await navLink.click();
  }

  async openSidebarButton(navBarButtonLabel: string) {
    const navLink = this.page.locator(
      `nav button[aria-label="${navBarButtonLabel}"]`,
    );
    await navLink.waitFor({ state: "visible" });
    await navLink.click();
  }

  async selectMuiBox(label: string, value: string) {
    await this.page.click(`div[aria-label="${label}"]`);
    const optionSelector = `li[role="option"]:has-text("${value}")`;
    await this.page.waitForSelector(optionSelector);
    await this.page.click(optionSelector);
  }

  async verifyRowsInTable(
    rowTexts: (string | RegExp)[],
    exact: boolean = true,
  ) {
    for (const rowText of rowTexts) {
      await this.verifyTextInLocator(`tr>td`, rowText, exact);
    }
  }

  async waitForTextDisappear(text: string) {
    await this.page.waitForSelector(`text=${text}`, { state: "detached" });
  }

  async verifyText(text: string | RegExp, exact: boolean = true) {
    await this.verifyTextInLocator("", text, exact);
  }

  private async verifyTextInLocator(
    locator: string,
    text: string | RegExp,
    exact: boolean,
  ) {
    const elementLocator = locator
      ? this.page.locator(locator).getByText(text, { exact }).first()
      : this.page.getByText(text, { exact }).first();

    await elementLocator.waitFor({ state: "visible", timeout: 10000 });
    await elementLocator.waitFor({ state: "attached", timeout: 10000 });

    try {
      await elementLocator.scrollIntoViewIfNeeded();
    } catch (error) {
      console.warn(
        `Warning: Could not scroll element into view. Error: ${error.message}`,
      );
    }
    await expect(elementLocator).toBeVisible();
  }

  async verifyTextInSelector(selector: string, expectedText: string) {
    const elementLocator = this.page
      .locator(selector)
      .getByText(expectedText, { exact: true });

    try {
      await elementLocator.waitFor({ state: "visible", timeout: 10000 });
      const actualText = (await elementLocator.textContent()) || "No content";

      if (actualText.trim() !== expectedText.trim()) {
        console.error(
          `Verification failed for text: Expected "${expectedText}", but got "${actualText}"`,
        );
        throw new Error(
          `Expected text "${expectedText}" not found. Actual content: "${actualText}".`,
        );
      }
      console.log(
        `Text "${expectedText}" verified successfully in selector: ${selector}`,
      );
    } catch (error) {
      const allTextContent = await this.page
        .locator(selector)
        .allTextContents();
      console.error(
        `Verification failed for text: Expected "${expectedText}". Selector content: ${allTextContent.join(", ")}`,
      );
      throw error;
    }
  }

  async verifyPartialTextInSelector(selector: string, partialText: string) {
    try {
      const elements = await this.page.locator(selector);
      const count = await elements.count();

      for (let i = 0; i < count; i++) {
        const textContent = await elements.nth(i).textContent();
        if (textContent && textContent.includes(partialText)) {
          console.log(
            `Found partial text: ${partialText} in element: ${textContent}`,
          );
          return;
        }
      }

      throw new Error(
        `Verification failed: Partial text "${partialText}" not found in any elements matching selector "${selector}".`,
      );
    } catch (error) {
      console.error(error.message);
      throw error;
    }
  }

  async verifyColumnHeading(
    rowTexts: string[] | RegExp[],
    exact: boolean = true,
  ) {
    for (const rowText of rowTexts) {
      const rowLocator = this.page
        .locator(`tr>th`)
        .getByText(rowText, { exact: exact })
        .first();
      await rowLocator.waitFor({ state: "visible" });
      await rowLocator.scrollIntoViewIfNeeded();
      await expect(rowLocator).toBeVisible();
    }
  }

  async verifyHeading(heading: string | RegExp, timeout: number = 20000) {
    const headingLocator = this.page
      .locator("h1, h2, h3, h4, h5, h6")
      .filter({ hasText: heading })
      .first();

    await headingLocator.waitFor({ state: "visible", timeout: timeout });
    await expect(headingLocator).toBeVisible();
  }

  async verifyParagraph(paragraph: string) {
    const headingLocator = this.page
      .locator("p")
      .filter({ hasText: paragraph })
      .first();
    await headingLocator.waitFor({ state: "visible", timeout: 20000 });
    await expect(headingLocator).toBeVisible();
  }

  async waitForTitle(text: string, level: number = 1) {
    await this.page.waitForSelector(`h${level}:has-text("${text}")`, {
      timeout: 10000,
    });
  }

  async clickTab(tabName: string) {
    const tabLocator = this.page.locator(`text="${tabName}"`);
    await tabLocator.waitFor({ state: "visible" });
    await tabLocator.click();
  }

  async verifyCellsInTable(texts: (string | RegExp)[]) {
    for (const text of texts) {
      const cellLocator = this.page
        .locator(UI_HELPER_ELEMENTS.MuiTableCell)
        .filter({ hasText: text });
      const count = await cellLocator.count();

      if (count === 0) {
        throw new Error(
          `Expected at least one cell with text matching ${text}, but none were found.`,
        );
      }

      // Checks if all matching cells are visible.
      for (let i = 0; i < count; i++) {
        await expect(cellLocator.nth(i)).toBeVisible();
      }
    }
  }

  getButtonSelector(label: string): string {
    return `${UI_HELPER_ELEMENTS.MuiButtonLabel}:has-text("${label}")`;
  }

  getLoginBtnSelector(): string {
    return 'MuiListItem-root li.MuiListItem-root button.MuiButton-root:has(span.MuiButton-label:text("Log in"))';
  }

  async waitForLoginBtnDisappear() {
    await this.page.waitForSelector(await this.getLoginBtnSelector(), {
      state: "detached",
    });
  }

  async verifyButtonURL(
    label: string | RegExp,
    url: string | RegExp,
    options: { locator?: string } = {
      locator: "",
    },
  ) {
    const buttonUrl =
      options.locator == ""
        ? await this.page
            .getByRole("button", { name: label })
            .first()
            .getAttribute("href")
        : await this.page
            .locator(options.locator)
            .getByRole("button", { name: label })
            .first()
            .getAttribute("href");
    expect(buttonUrl).toContain(url);
  }

  /**
   * Verifies that a table row, identified by unique text, contains specific cell texts.
   * @param {string} uniqueRowText - The unique text present in one of the cells within the row. This is used to identify the specific row.
   * @param {Array<string | RegExp>} cellTexts - An array of cell texts or regular expressions to match against the cells within the identified row.
   * @example
   * // Example usage to verify that a row containing "Developer-hub" has cells with the texts "service" and "active":
   * await verifyRowInTableByUniqueText('Developer-hub', ['service', 'active']);
   */

  async verifyRowInTableByUniqueText(
    uniqueRowText: string,
    cellTexts: string[] | RegExp[],
  ) {
    const row = this.page.locator(UI_HELPER_ELEMENTS.rowByText(uniqueRowText));
    await row.waitFor();
    for (const cellText of cellTexts) {
      await expect(
        row.locator("td").filter({ hasText: cellText }).first(),
      ).toBeVisible();
    }
  }

  /**
   * Clicks on a link within a table row that contains a unique text and matches a link's text.
   * @param {string} uniqueRowText - The unique text present in one of the cells within the row. This is used to identify the specific row.
   * @param {string | RegExp} linkText - The text of the link, can be a string or a regular expression.
   * @param {boolean} [exact=true] - Whether to match the link text exactly. By default, this is set to true.
   */
  async clickOnLinkInTableByUniqueText(
    uniqueRowText: string,
    linkText: string | RegExp,
    exact: boolean = true,
  ) {
    const row = this.page.locator(UI_HELPER_ELEMENTS.rowByText(uniqueRowText));
    await row.waitFor();
    await row
      .locator("a")
      .getByText(linkText, { exact: exact })
      .first()
      .click();
  }

  /**
   * Clicks on a button within a table row that contains a unique text and matches a button's label or aria-label.
   * @param {string} uniqueRowText - The unique text present in one of the cells within the row. This is used to identify the specific row.
   * @param {string | RegExp} textOrLabel - The text of the button or the `aria-label` attribute, can be a string or a regular expression.
   */
  async clickOnButtonInTableByUniqueText(
    uniqueRowText: string,
    textOrLabel: string | RegExp,
  ) {
    const row = this.page.locator(UI_HELPER_ELEMENTS.rowByText(uniqueRowText));
    await row.waitFor();
    await row
      .locator(
        `button:has-text("${textOrLabel}"), button[aria-label="${textOrLabel}"]`,
      )
      .first()
      .click();
  }

  async verifyLinkinCard(cardHeading: string, linkText: string, exact = true) {
    const link = this.page
      .locator(UI_HELPER_ELEMENTS.MuiCard(cardHeading))
      .locator("a")
      .getByText(linkText, { exact: exact })
      .first();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
  }

  async clickBtnInCard(cardText: string, btnText: string, exact = true) {
    const cardLocator = this.page
      .locator(UI_HELPER_ELEMENTS.MuiCardRoot(cardText))
      .first();
    await cardLocator.scrollIntoViewIfNeeded();
    await cardLocator
      .getByRole("button", { name: btnText, exact: exact })
      .first()
      .click();
  }

  async verifyTextinCard(
    cardHeading: string,
    text: string | RegExp,
    exact = true,
  ) {
    const locator = this.page
      .locator(UI_HELPER_ELEMENTS.MuiCard(cardHeading))
      .getByText(text, { exact: exact })
      .first();
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
  }

  async verifyTableHeadingAndRows(texts: string[]) {
    for (const column of texts) {
      const columnSelector = `table th:has-text("${column}")`;
      //check if  columnSelector has at least one element or more
      const columnCount = await this.page.locator(columnSelector).count();
      expect(columnCount).toBeGreaterThan(0);
    }

    // Checks if the table has at least one row with data
    // Excludes rows that have cells spanning multiple columns, such as "No data available" messages
    const rowSelector = `table tbody tr:not(:has(td[colspan]))`;
    const rowCount = await this.page.locator(rowSelector).count();
    expect(rowCount).toBeGreaterThan(0);
  }

  // Function to convert hexadecimal to RGB or return RGB if it's already in RGB
  toRgb(color: string): string {
    if (color.startsWith("rgb")) {
      return color;
    }

    const bigint = parseInt(color.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  async checkCssColor(page: Page, selector: string, expectedColor: string) {
    const elements = await page.locator(selector);
    const count = await elements.count();
    const expectedRgbColor = this.toRgb(expectedColor);

    for (let i = 0; i < count; i++) {
      const color = await elements
        .nth(i)
        .evaluate((el) => window.getComputedStyle(el).color);
      expect(color).toBe(expectedRgbColor);
    }
  }

  async verifyTableIsEmpty() {
    const rowSelector = `table tbody tr:not(:has(td[colspan]))`;
    const rowCount = await this.page.locator(rowSelector).count();
    expect(rowCount).toEqual(0);
  }

  async waitForCardWithHeader(cardHeading: string) {
    await this.page.waitForSelector(UI_HELPER_ELEMENTS.MuiCard(cardHeading));
  }

  async verifyAlertErrorMessage(message: string | RegExp) {
    const alert = this.page.getByRole("alert");
    await alert.waitFor();
    await expect(alert).toHaveText(message);
  }

  async clickById(id: string) {
    await this.page.click(`#${id}`);
  }

  async clickSpanByText(text: string) {
    await this.verifyText(text);
    await this.page.click(`span:has-text("${text}")`);
  }

  async verifyLocationRefreshButtonIsEnabled(locationName: string) {
    await expect(async () => {
      await this.page.goto("/");
      await this.openSidebar("Catalog");
      await this.selectMuiBox("Kind", "Location");
      await this.verifyHeading("All locations");
      await this.verifyCellsInTable([locationName]);
      await this.clickLink(locationName);
      await this.verifyHeading(locationName);
    }).toPass({
      intervals: [1_000, 2_000, 5_000],
      timeout: 20 * 1000,
    });

    await expect(
      this.page.locator(`button[title="Schedule entity refresh"]`),
    ).toHaveCount(1);

    await this.page.locator(`button[title="Schedule entity refresh"]`).click();
    await this.verifyAlertErrorMessage("Refresh scheduled");

    const moreButton = await this.page
      .locator("button[aria-label='more']")
      .first();
    await moreButton.waitFor({ state: "visible", timeout: 4000 });
    await moreButton.waitFor({ state: "attached", timeout: 4000 });
    await moreButton.click();

    const unregisterItem = await this.page
      .locator("li[role='menuitem']")
      .filter({ hasText: "Unregister entity" })
      .first();
    await unregisterItem.waitFor({ state: "visible", timeout: 4000 });
    await unregisterItem.waitFor({ state: "attached", timeout: 4000 });
    expect(unregisterItem).not.toBeDisabled();
  }

  async clickUnregisterButtonForDisplayedEntity() {
    const moreButton = await this.page
      .locator("button[aria-label='more']")
      .first();
    await moreButton.waitFor({ state: "visible" });
    await moreButton.waitFor({ state: "attached" });
    await moreButton.click();

    const unregisterItem = await this.page
      .locator("li[role='menuitem']")
      .filter({ hasText: "Unregister entity" })
      .first();
    await unregisterItem.waitFor({ state: "visible" });
    await unregisterItem.click();

    const deleteButton = await this.page.getByRole("button", {
      name: "Delete Entity",
    });
    await deleteButton.waitFor({ state: "visible" });
    await deleteButton.waitFor({ state: "attached" });
    await deleteButton.click();
  }

  /**
   * Verifies the values of the Enabled and Preinstalled columns for a specific row.
   *
   * @param text - Text to locate the specific row (based on the Name column).
   * @param expectedEnabled - Expected value for the Enabled column ("Yes" or "No").
   * @param expectedPreinstalled - Expected value for the Preinstalled column ("Yes" or "No").
   */
  async verifyPluginRow(
    text: string,
    expectedEnabled: string,
    expectedPreinstalled: string,
  ) {
    // Locate the row based on the text in the Name column
    const rowSelector = `tr:has(td:text-is("${text}"))`;
    const row = this.page.locator(rowSelector);

    // Locate the "Enabled" (3rd column) and "Preinstalled" (4th column) cells by their index
    const enabledColumn = row.locator("td").nth(2); // Index 2 for "Enabled"
    const preinstalledColumn = row.locator("td").nth(3); // Index 3 for "Preinstalled"

    await expect(enabledColumn).toHaveText(expectedEnabled);
    await expect(preinstalledColumn).toHaveText(expectedPreinstalled);
  }

  async verifyTextInTooltip(text: string | RegExp) {
    const tooltip = await this.page.getByRole("tooltip").getByText(text);
    expect(tooltip).toBeVisible();
  }
}
