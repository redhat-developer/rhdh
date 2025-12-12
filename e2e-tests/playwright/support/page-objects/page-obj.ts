import { Page, Locator } from "@playwright/test";
import { SemanticSelectors } from "../selectors/semantic-selectors";
import {
  getTranslations,
  getCurrentLanguage,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

/**
 * HOME_PAGE_COMPONENTS - Home page element selectors
 */
export const HOME_PAGE_COMPONENTS = {
  // Legacy selectors - maintained for backward compatibility
  /** @deprecated Use SemanticSelectors.region() with appropriate filter */
  MuiAccordion: 'div[class*="MuiAccordion-root-"]',
  /** @deprecated Use SemanticSelectors.region() or article with appropriate filter */
  MuiCard: 'div[class*="MuiCard-root-"]',

  // Semantic methods - preferred
  /**
   * Get accordion/expandable section by heading text
   * ✅ Preferred over MuiAccordion
   * @example HOME_PAGE_COMPONENTS.getAccordion(page, 'Quick Access').click()
   */
  getAccordion: (page: Page, heading: string | RegExp): Locator =>
    page
      .getByRole("button", { name: heading, expanded: false })
      .or(page.getByRole("button", { name: heading, expanded: true })),

  /**
   * Get card by heading or content
   * ✅ Preferred over MuiCard
   * @example HOME_PAGE_COMPONENTS.getCard(page, 'Recently Visited')
   */
  getCard: (page: Page, headingOrText: string | RegExp): Locator =>
    page
      .locator('[role="region"], article, section')
      .filter({
        hasText: headingOrText,
      })
      .first(),
};

/**
 * SEARCH_OBJECTS_COMPONENTS - Search input selectors
 */
export const SEARCH_OBJECTS_COMPONENTS = {
  // Legacy selectors - maintained for backward compatibility
  ariaLabelSearch: `input[aria-label="${t["search-react"][lang]["searchBar.title"]}"]`,
  placeholderSearch: `input[placeholder="${t["search-react"][lang]["searchBar.title"]}"]`,

  // Semantic methods - preferred
  /**
   * Get search input (tries label first, then placeholder)
   * ✅ Preferred approach
   * @example SEARCH_OBJECTS_COMPONENTS.getSearchInput(page).fill('test')
   */
  getSearchInput: (page: Page): Locator => {
    const searchTitle = t["search-react"][lang]["searchBar.title"];
    return page.getByLabel(searchTitle).or(page.getByPlaceholder(searchTitle));
  },
};

/**
 * CATALOG_IMPORT_COMPONENTS - Catalog import selectors
 */
export const CATALOG_IMPORT_COMPONENTS = {
  // This selector is already semantic (using name attribute)
  componentURL: 'input[name="url"]',

  // Semantic method - preferred
  /**
   * Get component URL input
   * ✅ Preferred when label exists
   * @example CATALOG_IMPORT_COMPONENTS.getURLInput(page).fill('https://...')
   */
  getURLInput: (page: Page): Locator => page.locator('input[name="url"]'),
};

/**
 * KUBERNETES_COMPONENTS - Kubernetes plugin selectors
 */
export const KUBERNETES_COMPONENTS = {
  // Legacy selectors - maintained for backward compatibility
  /** @deprecated Use getClusterAccordion() method */
  MuiAccordion: 'div[class*="MuiAccordion-root-"]',
  /** ✅ This is already semantic - using aria-label */
  statusOk: 'span[aria-label="Status ok"]',
  /** ✅ This is already semantic - using aria-label */
  podLogs: 'label[aria-label="get logs"]',
  /** @deprecated Use SemanticSelectors.alert() */
  MuiSnackbarContent: 'div[class*="MuiSnackbarContent-message-"]',

  // Semantic methods - preferred
  /**
   * Get cluster accordion by cluster name
   * ✅ Preferred over MuiAccordion
   * @example KUBERNETES_COMPONENTS.getClusterAccordion(page, 'production').click()
   */
  getClusterAccordion: (page: Page, clusterName?: string | RegExp): Locator => {
    if (clusterName) {
      return page
        .getByRole("button", { name: clusterName, expanded: false })
        .or(page.getByRole("button", { name: clusterName, expanded: true }));
    }
    // Get first accordion button (buttons with expanded attribute)
    return page
      .getByRole("button", { expanded: false })
      .or(page.getByRole("button", { expanded: true }))
      .first();
  },

  /**
   * Get status indicator
   * @example await expect(KUBERNETES_COMPONENTS.getStatus(page, 'ok')).toBeVisible()
   */
  getStatus: (page: Page, status: string): Locator =>
    page.locator(`span[aria-label="Status ${status}"]`),

  /**
   * Get pod logs label/button
   * @example KUBERNETES_COMPONENTS.getPodLogsButton(page).click()
   */
  getPodLogsButton: (page: Page): Locator =>
    page.locator('label[aria-label="get logs"]'),

  /**
   * Get error/notification snackbar
   * ✅ Preferred over MuiSnackbarContent
   * @example await expect(KUBERNETES_COMPONENTS.getNotification(page)).toContainText('Error')
   */
  getNotification: (page: Page, message?: string | RegExp): Locator =>
    message
      ? SemanticSelectors.alert(page, message)
      : SemanticSelectors.alert(page),
};

/**
 * BACKSTAGE_SHOWCASE_COMPONENTS - Table pagination selectors
 */
export const BACKSTAGE_SHOWCASE_COMPONENTS = {
  // Legacy selectors - maintained for backward compatibility
  /** ✅ These are already semantic - using aria-label */
  tableNextPage: 'button[aria-label="Next Page"]',
  tablePreviousPage: 'button[aria-label="Previous Page"]',
  tableLastPage: 'button[aria-label="Last Page"]',
  tableFirstPage: 'button[aria-label="First Page"]',
  /** @deprecated Use getTableRows() method */
  tableRows: 'table[class*="MuiTable-root-"] tbody tr',
  /** @deprecated Use pagination role-based selector */
  tablePageSelectBox: 'div[class*="MuiTablePagination-input"]',

  // Semantic methods - preferred
  /**
   * Get next page button
   * ✅ Already semantic, but wrapped for consistency
   * @example BACKSTAGE_SHOWCASE_COMPONENTS.getNextPageButton(page).click()
   */
  getNextPageButton: (page: Page): Locator =>
    page.getByRole("button", { name: "Next Page" }),

  /**
   * Get previous page button
   * @example BACKSTAGE_SHOWCASE_COMPONENTS.getPreviousPageButton(page).click()
   */
  getPreviousPageButton: (page: Page): Locator =>
    page.getByRole("button", { name: "Previous Page" }),

  /**
   * Get last page button
   * @example BACKSTAGE_SHOWCASE_COMPONENTS.getLastPageButton(page).click()
   */
  getLastPageButton: (page: Page): Locator =>
    page.getByRole("button", { name: "Last Page" }),

  /**
   * Get first page button
   * @example BACKSTAGE_SHOWCASE_COMPONENTS.getFirstPageButton(page).click()
   */
  getFirstPageButton: (page: Page): Locator =>
    page.getByRole("button", { name: "First Page" }),

  /**
   * Get table rows
   * ✅ Preferred over tableRows
   * @example const rows = BACKSTAGE_SHOWCASE_COMPONENTS.getTableRows(page)
   */
  getTableRows: (page: Page): Locator =>
    SemanticSelectors.table(page).locator("tbody tr"),

  /**
   * Get specific table row by content
   * @example const row = BACKSTAGE_SHOWCASE_COMPONENTS.getTableRow(page, 'Guest User')
   */
  getTableRow: (page: Page, text: string | RegExp): Locator =>
    SemanticSelectors.tableRow(page, text),
};

/**
 * SETTINGS_PAGE_COMPONENTS - Settings page selectors
 */
export const SETTINGS_PAGE_COMPONENTS = {
  // These are already using data-testid which is acceptable
  userSettingsMenu: 'button[data-testid="user-settings-menu"]',
  signOut: 'li[data-testid="sign-out"]',

  // Semantic methods - preferred
  /**
   * Get user settings menu button
   * @example SETTINGS_PAGE_COMPONENTS.getUserSettingsMenu(page).click()
   */
  getUserSettingsMenu: (page: Page): Locator =>
    page.getByTestId("user-settings-menu"),

  /**
   * Get sign out menu item
   * @example SETTINGS_PAGE_COMPONENTS.getSignOut(page).click()
   */
  getSignOut: (page: Page): Locator => page.getByTestId("sign-out"),
};

/**
 * ROLES_PAGE_COMPONENTS - RBAC roles page selectors
 */
export const ROLES_PAGE_COMPONENTS = {
  // These are already using data-testid which is acceptable
  editRole: (name: string) => `button[data-testid="edit-role-${name}"]`,
  deleteRole: (name: string) => `button[data-testid="delete-role-${name}"]`,

  // Semantic methods - preferred
  /**
   * Get edit role button
   * @example ROLES_PAGE_COMPONENTS.getEditRoleButton(page, 'admin').click()
   */
  getEditRoleButton: (page: Page, name: string): Locator =>
    page.getByTestId(`edit-role-${name}`),

  /**
   * Get delete role button
   * @example ROLES_PAGE_COMPONENTS.getDeleteRoleButton(page, 'guest').click()
   */
  getDeleteRoleButton: (page: Page, name: string): Locator =>
    page.getByTestId(`delete-role-${name}`),
};

/**
 * DELETE_ROLE_COMPONENTS - Delete role dialog selectors
 */
export const DELETE_ROLE_COMPONENTS = {
  // This selector is already semantic (using name attribute)
  roleName: 'input[name="delete-role"]',

  // Semantic method - preferred
  /**
   * Get role name confirmation input
   * @example DELETE_ROLE_COMPONENTS.getRoleNameInput(page).fill('role-name')
   */
  getRoleNameInput: (page: Page): Locator =>
    page.locator('input[name="delete-role"]'),
};

/**
 * ROLE_OVERVIEW_COMPONENTS_TEST_ID - Role overview test IDs
 */
export const ROLE_OVERVIEW_COMPONENTS_TEST_ID = {
  updatePolicies: "update-policies",
  updateMembers: "update-members",

  // Semantic methods - preferred
  /**
   * Get update policies button
   * @example ROLE_OVERVIEW_COMPONENTS_TEST_ID.getUpdatePoliciesButton(page).click()
   */
  getUpdatePoliciesButton: (page: Page): Locator =>
    page.getByTestId("update-policies"),

  /**
   * Get update members button
   * @example ROLE_OVERVIEW_COMPONENTS_TEST_ID.getUpdateMembersButton(page).click()
   */
  getUpdateMembersButton: (page: Page): Locator =>
    page.getByTestId("update-members"),
};
