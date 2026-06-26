import { Locator, Page } from "@playwright/test";

import { SEARCH_OBJECTS_COMPONENTS } from "../../support/selectors/page-selectors";
import * as interaction from "./interaction";
import * as misc from "./misc";
import * as navigation from "./navigation";
import * as table from "./table";
import * as verification from "./verification";
import * as visibility from "./visibility";

export class UIhelper {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  verifyComponentInCatalog(kind: string, expectedRows: string[]) {
    return misc.verifyComponentInCatalog(this.page, kind, expectedRows);
  }

  getSideBarMenuItem(sectionName: string): Locator {
    return this.page.locator("nav").filter({
      has: this.page.locator(`button[aria-label="${sectionName}"]`),
    });
  }

  fillTextInputByLabel(label: string, text: string) {
    return interaction.fillTextInputByLabel(this.page, label, text);
  }

  searchInputPlaceholder(searchText: string) {
    return this.page.fill(SEARCH_OBJECTS_COMPONENTS.placeholderSearch, searchText);
  }

  searchInputAriaLabel(searchText: string) {
    return this.page.fill(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch, searchText);
  }

  pressTab() {
    return interaction.pressTab(this.page);
  }

  checkCheckbox(text: string) {
    return interaction.checkCheckbox(this.page, text);
  }

  uncheckCheckbox(text: string) {
    return interaction.uncheckCheckbox(this.page, text);
  }

  clickButton(label: string | RegExp, options?: { exact?: boolean; force?: boolean }) {
    return interaction.clickButton(this.page, label, options);
  }

  clickBtnByTitleIfNotPressed(title: string) {
    return interaction.clickBtnByTitleIfNotPressed(this.page, title);
  }

  clickByDataTestId(dataTestId: string) {
    return interaction.clickByDataTestId(this.page, dataTestId);
  }

  clickDivByTitle(title: string) {
    return interaction.clickDivByTitle(this.page, title);
  }

  clickButtonByText(
    buttonText: string | RegExp,
    options?: {
      exact?: boolean;
      timeout?: number;
      force?: boolean;
    },
  ) {
    return interaction.clickButtonByText(this.page, buttonText, options);
  }

  clickButtonByLabel(label: string | RegExp) {
    return interaction.clickButtonByLabel(this.page, label);
  }

  markAllNotificationsAsReadIfVisible() {
    return navigation.markAllNotificationsAsReadIfVisible(this.page);
  }

  clickByTitleIfVisible(title: string, elementType: string = "div") {
    return interaction.clickByTitleIfVisible(this.page, title, elementType);
  }

  verifyDivHasText(divText: string | RegExp) {
    return verification.verifyDivHasText(this.page, divText);
  }

  clickLink(options: string | { href: string } | { ariaLabel: string }) {
    return interaction.clickLink(this.page, options);
  }

  openProfileDropdown() {
    return navigation.openProfileDropdown(this.page);
  }

  goToPageUrl(url: string, heading?: string) {
    return navigation.goToPageUrl(this.page, url, heading);
  }

  goToMyProfilePage() {
    return navigation.goToMyProfilePage(this.page);
  }

  goToSettingsPage() {
    return navigation.goToSettingsPage(this.page);
  }

  goToSelfServicePage() {
    return navigation.goToSelfServicePage(this.page);
  }

  verifyLink(arg: string | { label: string }, options?: { exact?: boolean; notVisible?: boolean }) {
    return verification.verifyLink(this.page, arg, options);
  }

  isBtnVisibleByTitle(text: string) {
    return visibility.isBtnVisibleByTitle(this.page, text);
  }

  isBtnVisible(text: string) {
    return visibility.isBtnVisible(this.page, text);
  }

  isTextVisible(text: string, timeout = 10000) {
    return visibility.isTextVisible(this.page, text, timeout);
  }

  verifyTextVisible(text: string, exact = false, timeout = 10000) {
    return verification.verifyTextVisible(this.page, text, exact, timeout);
  }

  verifyLinkVisible(text: string, timeout = 10000) {
    return verification.verifyLinkVisible(this.page, text, timeout);
  }

  waitForSideBarVisible() {
    return navigation.waitForSideBarVisible(this.page);
  }

  openSidebar(navBarText: string) {
    return navigation.openSidebar(this.page, navBarText);
  }

  openCatalogSidebar(kind: string) {
    return navigation.openCatalogSidebar(this.page, kind);
  }

  openSidebarButton(navBarButtonLabel: string) {
    return navigation.openSidebarButton(this.page, navBarButtonLabel);
  }

  selectMuiBox(label: string, value: string, notVisible?: boolean) {
    return navigation.selectMuiBox(this.page, label, value, notVisible);
  }

  verifyRowsInTable(rowTexts: (string | RegExp)[], exact: boolean = true) {
    return verification.verifyRowsInTable(this.page, rowTexts, exact);
  }

  waitForTextDisappear(text: string) {
    return verification.waitForTextDisappear(this.page, text);
  }

  verifyText(text: string | RegExp, exact: boolean = true, timeout: number = 5000) {
    return verification.verifyText(this.page, text, exact, timeout);
  }

  verifyTextInSelector(selector: string, expectedText: string) {
    return verification.verifyTextInSelector(this.page, selector, expectedText);
  }

  verifyPartialTextInSelector(selector: string, partialText: string) {
    return verification.verifyPartialTextInSelector(this.page, selector, partialText);
  }

  verifyColumnHeading(rowTexts: string[] | RegExp[], exact: boolean = true) {
    return verification.verifyColumnHeading(this.page, rowTexts, exact);
  }

  verifyHeading(heading: string | RegExp, timeout: number = 20000) {
    return verification.verifyHeading(this.page, heading, timeout);
  }

  verifyParagraph(paragraph: string) {
    return verification.verifyParagraph(this.page, paragraph);
  }

  waitForTitle(text: string, level: number = 1) {
    return verification.waitForTitle(this.page, text, level);
  }

  clickTab(tabName: string) {
    return interaction.clickTab(this.page, tabName);
  }

  verifyCellsInTable(texts: (string | RegExp)[]) {
    return table.verifyCellsInTable(this.page, texts);
  }

  getButtonSelector(label: string): string {
    return `button:has-text("${label}")`;
  }

  getLoginBtnSelector(): string {
    return 'button:has-text("Log in")';
  }

  waitForLoginBtnDisappear() {
    return table.waitForLoginBtnDisappear(this.page);
  }

  verifyButtonURL(
    label: string | RegExp,
    url: string | RegExp,
    options?: { locator?: string | Locator; exact?: boolean },
  ) {
    return table.verifyButtonURL(this.page, label, url, options);
  }

  verifyRowInTableByUniqueText(uniqueRowText: string, cellTexts: string[] | RegExp[]) {
    return table.verifyRowInTableByUniqueText(this.page, uniqueRowText, cellTexts);
  }

  clickOnLinkInTableByUniqueText(
    uniqueRowText: string,
    linkText: string | RegExp,
    exact: boolean = true,
  ) {
    return table.clickOnLinkInTableByUniqueText(this.page, uniqueRowText, linkText, exact);
  }

  clickOnButtonInTableByUniqueText(uniqueRowText: string, textOrLabel: string | RegExp) {
    return table.clickOnButtonInTableByUniqueText(this.page, uniqueRowText, textOrLabel);
  }

  verifyLinkinCard(cardHeading: string, linkText: string, exact = true) {
    return misc.verifyLinkinCard(this.page, cardHeading, linkText, exact);
  }

  clickBtnInCard(cardText: string, btnText: string, exact = true) {
    return interaction.clickBtnInCard(this.page, cardText, btnText, exact);
  }

  verifyTextinCard(cardHeading: string, text: string | RegExp, exact = true) {
    return misc.verifyTextinCard(this.page, cardHeading, text, exact);
  }

  verifyTableHeadingAndRows(texts: string[]) {
    return table.verifyTableHeadingAndRows(this.page, texts);
  }

  toRgb(color: string): string {
    return misc.toRgb(color);
  }

  checkCssColor(page: Page, selector: string, expectedColor: string) {
    return misc.checkCssColor(page, selector, expectedColor);
  }

  verifyTableIsEmpty() {
    return table.verifyTableIsEmpty(this.page);
  }

  waitForCardWithHeader(cardHeading: string) {
    return misc.waitForCardWithHeader(this.page, cardHeading);
  }

  verifyAlertErrorMessage(message: string | RegExp) {
    return verification.verifyAlertErrorMessage(this.page, message);
  }

  clickById(id: string) {
    return interaction.clickById(this.page, id);
  }

  clickSpanByText(text: string) {
    return verification.clickSpanByText(this.page, text);
  }

  verifyLocationRefreshButtonIsEnabled(locationName: string) {
    return misc.verifyLocationRefreshButtonIsEnabled(this.page, locationName);
  }

  clickUnregisterButtonForDisplayedEntity(
    buttonName: "Delete Entity" | "Unregister Location" = "Delete Entity",
  ) {
    return misc.clickUnregisterButtonForDisplayedEntity(this.page, buttonName);
  }

  verifyPluginRow(text: string, expectedEnabled: string, expectedPreinstalled: string) {
    return table.verifyPluginRow(this.page, text, expectedEnabled, expectedPreinstalled);
  }

  verifyTextInTooltip(text: string | RegExp) {
    return verification.verifyTextInTooltip(this.page, text);
  }

  hideQuickstartIfVisible() {
    return misc.hideQuickstartIfVisible(this.page);
  }

  openQuickstartIfHidden() {
    return misc.openQuickstartIfHidden(this.page);
  }
}
