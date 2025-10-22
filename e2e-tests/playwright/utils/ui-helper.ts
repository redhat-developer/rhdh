import { expect, Locator, Page } from "@playwright/test";
import { UI_HELPER_ELEMENTS } from "../support/page-objects/global-obj";
import { SidebarTabs } from "./navbar";
import { SEARCH_OBJECTS_COMPONENTS } from "../support/page-objects/page-obj";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();
export class UIhelper {
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
    await this.page.fill(
      SEARCH_OBJECTS_COMPONENTS.placeholderSearch,
      searchText,
    );
  }

  async searchInputAriaLabel(searchText: string) {
    await this.page.fill(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch, searchText);
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

  async uncheckCheckbox(text: string) {
    const locator = this.page.getByRole("checkbox", {
      name: text,
    });
    await locator.uncheck();
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
      // eslint-disable-next-line playwright/no-force-option
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
    await element.dispatchEvent("click");
  }

  /**
   * Clicks on a div element by its title attribute.
   *
   * @param title - The title attribute value of the div to click on.
   */
  async clickDivByTitle(title: string) {
    const divElement = this.page.locator(`div[title="${title}"]`);
    await divElement.waitFor({ state: "visible" });
    await divElement.click();
  }

  /**
   * Clicks on a button element by its text content, waiting for it to be visible first.
   *
   * @param buttonText - The text content of the button to click on.
   * @param options - Optional configuration for exact match, timeout, and force click.
   */
  async clickButtonByText(
    buttonText: string | RegExp,
    options: {
      exact?: boolean;
      timeout?: number;
      force?: boolean;
    } = {
      exact: true,
      timeout: 10000,
      force: false,
    },
  ) {
    const buttonElement = this.page
      .getByRole("button")
      .getByText(buttonText, { exact: options.exact });

    await buttonElement.waitFor({
      state: "visible",
      timeout: options.timeout,
    });

    if (options.force) {
      // eslint-disable-next-line playwright/no-force-option
      await buttonElement.click({ force: true });
    } else {
      await buttonElement.click();
    }
  }

  async clickButtonByLabel(label: string | RegExp) {
    await this.page.getByRole("button", { name: label }).first().click();
  }

  /**
   * Conditionally clicks on "Mark all read" if visible, then clicks on "Mark All".
   * This method handles the two-step process of marking all notifications as read.
   */
  async markAllNotificationsAsReadIfVisible() {
    try {
      // Check if "Mark all read" div is visible
      const markAllReadDiv = this.page.locator('div[title="Mark all read"]');
      const isVisible = await markAllReadDiv.isVisible();

      if (isVisible) {
        // Click on "Mark all read" div first
        await markAllReadDiv.click();

        // Then click on "Mark All" button
        await this.clickButtonByText("Mark All", {
          timeout: 5000,
        });
      }
    } catch (error) {
      console.log(
        "Mark all read functionality not available or already processed: ",
        error,
      );
    }
  }

  /**
   * Clicks on an element by title only if it's visible.
   *
   * @param title - The title attribute value of the element to click on.
   * @param elementType - The type of element (default: 'div').
   * @returns Promise<boolean> - Returns true if element was clicked, false if not visible.
   */
  async clickByTitleIfVisible(
    title: string,
    elementType: string = "div",
  ): Promise<boolean> {
    try {
      const element = this.page.locator(`${elementType}[title="${title}"]`);
      const isVisible = await element.isVisible();

      if (isVisible) {
        await element.click();
        return true;
      }
      return false;
    } catch (error) {
      console.log(
        `Element with title "${title}" not found or not clickable: `,
        error,
      );
      return false;
    }
  }

  async verifyDivHasText(divText: string | RegExp) {
    await expect(this.page.locator(`div`).getByText(divText)).toBeVisible();
  }

  async clickLink(options: string | { href: string } | { ariaLabel: string }) {
    let linkLocator: Locator;

    if (typeof options === "string") {
      linkLocator = this.page.locator("a").filter({ hasText: options }).first();
    } else if ("href" in options) {
      linkLocator = this.page.locator(`a[href="${options.href}"]`).first();
    } else {
      linkLocator = this.page
        .locator(`div[aria-label='${options.ariaLabel}'] a`)
        .first();
    }

    await linkLocator.waitFor({ state: "visible" });
    await linkLocator.click();
  }

  async openProfileDropdown() {
    const header = this.page.locator("nav[id='global-header']");
    await expect(header).toBeVisible();
    await header
      .locator("[data-testid='KeyboardArrowDownOutlinedIcon']")
      .click();
  }

  async goToPageUrl(url: string, heading?: string) {
    await this.page.goto(url);
    await expect(this.page).toHaveURL(url);
    if (heading) {
      await this.verifyHeading(heading);
    }
  }

  async goToMyProfilePage() {
    await expect(this.page.locator("nav[id='global-header']")).toBeVisible();
    await this.openProfileDropdown();
    await this.clickLink(t["plugin.global-header"][lang]["profile.myProfile"]);
  }

  async verifyLink(
    arg: string | { label: string },
    options: {
      exact?: boolean;
      notVisible?: boolean;
    } = {
      exact: true,
      notVisible: false,
    },
  ) {
    let linkLocator: Locator;
    let notVisibleCheck: boolean;

    if (typeof arg != "object") {
      linkLocator = this.page
        .locator("a")
        .getByText(arg, { exact: options.exact })
        .first();

      notVisibleCheck = options?.notVisible;
    } else {
      linkLocator = this.page.locator(`div[aria-label="${arg.label}"] a`);
      notVisibleCheck = false;
    }

    if (notVisibleCheck) {
      await expect(linkLocator).toBeHidden();
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

  async verifyTextVisible(
    text: string,
    exact = false,
    timeout = 10000,
  ): Promise<void> {
    const locator = this.page.getByText(text, { exact });
    await expect(locator).toBeVisible({ timeout });
  }

  async verifyLinkVisible(text: string, timeout = 10000): Promise<void> {
    const locator = this.page.locator(`a:has-text("${text}")`);
    await expect(locator).toBeVisible({ timeout });
  }

  async waitForSideBarVisible() {
    await this.page.waitForSelector("nav a", { timeout: 10_000 });
  }

  async openSidebar(navBarText: SidebarTabs) {
    const navLink = this.page
      .locator(`nav a:has-text("${navBarText}")`)
      .first();
    await navLink.waitFor({ state: "visible", timeout: 15_000 });
    await navLink.dispatchEvent("click");
  }

  async openCatalogSidebar(kind: string) {
    await this.openSidebar("Catalog");
    await this.selectMuiBox("Kind", kind);
    await expect(async () => {
      await this.clickByDataTestId("user-picker-all");
      await this.page.waitForTimeout(1_500);
      await this.verifyHeading(new RegExp(`all ${kind}`, "i"));
    }).toPass({
      intervals: [3_000],
      timeout: 20_000,
    });
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

    await elementLocator.waitFor({ state: "visible" });
    await elementLocator.waitFor({ state: "attached" });

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
      await elementLocator.waitFor({ state: "visible" });
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
      const elements = this.page.locator(selector);
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
    await this.page.waitForSelector(`h${level}:has-text("${text}")`);
  }

  async clickTab(tabName: string) {
    const tabLocator = this.page.getByRole("tab", { name: tabName });
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
    await this.page.waitForSelector(this.getLoginBtnSelector(), {
      state: "detached",
    });
  }

  async verifyButtonURL(
    label: string | RegExp,
    url: string | RegExp,
    options: { locator?: string; exact?: boolean } = {
      locator: "",
      exact: true,
    },
  ) {
    // To verify the button URL if it is in a specific locator
    const baseLocator =
      !options.locator || options.locator === ""
        ? this.page
        : this.page.locator(options.locator);

    const buttonUrl = await baseLocator
      .getByRole("button", { name: label, exact: options.exact })
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
    // Wait for the table to load by checking for the presence of table rows
    await this.page.waitForSelector("table tbody tr", { state: "visible" });
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
    const elements = page.locator(selector);
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
    const locator = this.page.locator(`#${id}`);
    await locator.waitFor({ state: "attached" });
    await locator.click();
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

    const moreButton = this.page.locator("button[aria-label='more']").first();
    await moreButton.waitFor({ state: "visible", timeout: 4000 });
    await moreButton.waitFor({ state: "attached", timeout: 4000 });
    await moreButton.click();

    const unregisterItem = this.page
      .locator("li[role='menuitem']")
      .filter({ hasText: "Unregister entity" })
      .first();
    await unregisterItem.waitFor({ state: "visible", timeout: 4000 });
    await unregisterItem.waitFor({ state: "attached", timeout: 4000 });
    await expect(unregisterItem).toBeEnabled();
  }

  async clickUnregisterButtonForDisplayedEntity() {
    const moreButton = this.page.locator("button[aria-label='more']").first();
    await moreButton.waitFor({ state: "visible" });
    await moreButton.waitFor({ state: "attached" });
    await moreButton.click();

    const unregisterItem = this.page
      .locator("li[role='menuitem']")
      .filter({ hasText: "Unregister entity" })
      .first();
    await unregisterItem.waitFor({ state: "visible" });
    await unregisterItem.click();

    const deleteButton = this.page.getByRole("button", {
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
    const tooltip = this.page.getByRole("tooltip").getByText(text);
    await expect(tooltip).toBeVisible();
  }
}
