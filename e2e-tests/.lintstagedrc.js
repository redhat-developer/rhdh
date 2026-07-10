/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  "*.sh": "shellcheck --severity=warning --color=always",
  "*": "yarn fmt",
  "*.{js,jsx,ts,tsx,mjs,cjs}": "yarn lint:fix",
};
