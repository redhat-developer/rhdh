/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  "*.sh": "shellcheck --severity=warning --color=always",
  "*": "yarn oxfmt:fix",
  "*.{js,jsx,ts,tsx,mjs,cjs}": "yarn oxlint:check",
};
