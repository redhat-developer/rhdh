export const HOME_PAGE_COMPONENTS = {
  MuiAccordion: 'div[class*="MuiAccordion-root-"]',
  MuiCard: 'div[class*="MuiCard-root-"]',
};

export const SEARCH_OBJECTS_COMPONENTS = {
  ariaLabelSearch: 'input[aria-label="Search"]',
  placeholderSearch: 'input[placeholder="Search"]',
};

export const CATALOG_IMPORT_COMPONENTS = {
  componentURL: 'input[name="url"]',
};

export const BACKSTAGE_SHOWCASE_COMPONENTS = {
  tableNextPage: 'button[aria-label="Next Page"]',
  tablePreviousPage: 'button[aria-label="Previous Page"]',
  tableLastPage: 'button[aria-label="Last Page"]',
  tableFirstPage: 'button[aria-label="First Page"]',
  tableRows: 'table[class*="MuiTable-root-"] tbody tr',
  tablePageSelectBox: 'div[class*="MuiTablePagination-input"]',
};

export const SETTINGS_PAGE_COMPONENTS = {
  userSettingsMenu: 'button[data-testid="user-settings-menu"]',
  signOut: 'li[data-testid="sign-out"]',
};

export const ROLES_PAGE_COMPONENTS = {
  editRole: (name: string) => `span[data-testid="update-role-${name}"]`,
  deleteRole: (name: string) => `span[data-testid="delete-role-${name}"]`,
};

export const DELETE_ROLE_COMPONENTS = {
  roleName: 'input[name="delete-role"]',
};

export const ROLE_OVERVIEW_COMPONENTS = {
  updatePolicies: 'span[data-testid="update-policies"]',
  updateMembers: 'span[data-testid="update-members"]',
};
