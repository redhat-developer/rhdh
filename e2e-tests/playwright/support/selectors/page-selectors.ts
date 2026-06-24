/* oxlint-disable playwright/no-raw-locators -- Legacy CSS selector constants; prefer SemanticSelectors get*() methods */
import { Page, Locator } from "@playwright/test";
import { SemanticSelectors } from "./semantic-selectors";
import {
  getTranslations,
  getCurrentLanguage,
} from "../../e2e/localization/locale";

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

/** Kubernetes plugin selectors. */
export const KUBERNETES_COMPONENTS = {
  /** @deprecated Use getClusterAccordion() method */
  MuiAccordion: 'div[class*="MuiAccordion-root-"]',
  statusOk: 'span[aria-label="Status ok"]',
  podLogs: 'label[aria-label="get logs"]',
  /** @deprecated Use SemanticSelectors.alert() */
  MuiSnackbarContent: 'div[class*="MuiSnackbarContent-message-"]',

  getClusterAccordion: (page: Page, clusterName?: string | RegExp): Locator => {
    if (clusterName !== undefined) {
      return page
        .getByRole("button", { name: clusterName, expanded: false })
        .or(page.getByRole("button", { name: clusterName, expanded: true }));
    }
    return page
      .getByRole("button", { expanded: false })
      .or(page.getByRole("button", { expanded: true }))
      .first();
  },

  getStatus: (page: Page, status: string): Locator =>
    page.locator(`span[aria-label="Status ${status}"]`),

  getPodLogsButton: (page: Page): Locator =>
    page.locator('label[aria-label="get logs"]'),

  getNotification: (page: Page, message?: string | RegExp): Locator =>
    message === undefined
      ? SemanticSelectors.alert(page)
      : SemanticSelectors.alert(page, message),
};

/** Settings page selectors. */
export const SETTINGS_PAGE_COMPONENTS = {
  userSettingsMenu: 'button[data-testid="user-settings-menu"]',
  signOut: 'li[data-testid="sign-out"]',

  getUserSettingsMenu: (page: Page): Locator =>
    page.getByTestId("user-settings-menu"),

  getSignOut: (page: Page): Locator => page.getByTestId("sign-out"),
};

/** RBAC roles page selectors. */
export const ROLES_PAGE_COMPONENTS = {
  editRole: (name: string) => `button[data-testid="edit-role-${name}"]`,
  deleteRole: (name: string) => `button[data-testid="delete-role-${name}"]`,

  getEditRoleButton: (page: Page, name: string): Locator =>
    page.getByTestId(`edit-role-${name}`),

  getDeleteRoleButton: (page: Page, name: string): Locator =>
    page.getByTestId(`delete-role-${name}`),
};

/** Delete role dialog selectors. */
export const DELETE_ROLE_COMPONENTS = {
  roleName: 'input[name="delete-role"]',

  getRoleNameInput: (page: Page): Locator =>
    page.locator('input[name="delete-role"]'),
};

/** Role overview test IDs. */
export const ROLE_OVERVIEW_COMPONENTS_TEST_ID = {
  updatePolicies: "update-policies",
  updateMembers: "update-members",

  getUpdatePoliciesButton: (page: Page): Locator =>
    page.getByTestId("update-policies"),

  getUpdateMembersButton: (page: Page): Locator =>
    page.getByTestId("update-members"),
};
