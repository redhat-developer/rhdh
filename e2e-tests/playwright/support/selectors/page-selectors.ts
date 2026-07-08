/* oxlint-disable playwright/no-raw-locators -- Legacy CSS selector constants; prefer SemanticSelectors get*() methods */
import { Page, Locator } from "@playwright/test";

import { getTranslations, getCurrentLanguage } from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

/** Home page element selectors. */
export const HOME_PAGE_COMPONENTS = {
  /** @deprecated Use SemanticSelectors.region() with appropriate filter */
  MuiAccordion: 'div[class*="MuiAccordion-root-"]',
  /** @deprecated Use SemanticSelectors.region() or article with appropriate filter */
  MuiCard: 'div[class*="MuiCard-root-"]',

  getAccordion: (page: Page, heading: string | RegExp): Locator =>
    page
      .getByRole("button", { name: heading, expanded: false })
      .or(page.getByRole("button", { name: heading, expanded: true })),

  getCard: (page: Page, headingOrText: string | RegExp): Locator =>
    page
      .locator('[role="region"], article, section')
      .filter({
        hasText: headingOrText,
      })
      .first(),
};

/** Search input selectors. */
export const SEARCH_OBJECTS_COMPONENTS = {
  ariaLabelSearch: `input[aria-label="${t["search-react"][lang]["searchBar.title"]}"]`,
  placeholderSearch: `input[placeholder="${t["search-react"][lang]["searchBar.title"]}"]`,

  getSearchInput: (page: Page): Locator => {
    const searchTitle = t["search-react"][lang]["searchBar.title"];
    return page.getByLabel(searchTitle).or(page.getByPlaceholder(searchTitle));
  },
};

/** Catalog import selectors. */
export const CATALOG_IMPORT_COMPONENTS = {
  componentURL: 'input[name="url"]',

  getURLInput: (page: Page): Locator => page.locator('input[name="url"]'),
};

/** Settings page selectors. */
export const SETTINGS_PAGE_COMPONENTS = {
  userSettingsMenu: 'button[data-testid="user-settings-menu"]',
  signOut: 'li[data-testid="sign-out"]',

  getUserSettingsMenu: (page: Page): Locator => page.getByTestId("user-settings-menu"),

  getSignOut: (page: Page): Locator => page.getByTestId("sign-out"),
};
