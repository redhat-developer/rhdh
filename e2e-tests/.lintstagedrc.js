/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  "*.sh": "shellcheck --severity=warning --color=always",
  "*": "yarn prettier:fix",
  "*.{js,jsx,ts,tsx,mjs,cjs}": "yarn lint:fix",
  "*.{ts,tsx}": () => "yarn tsc:check",
};
