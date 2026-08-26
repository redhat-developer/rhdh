/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  "*.sh": [
    "shellcheck --severity=warning --color=always",
    "prettier --write --plugin=prettier-plugin-sh",
  ],
  "*": (filenames) => {
    const nonShell = filenames.filter((file) => !file.endsWith(".sh"));
    return nonShell.length > 0 ? [`oxfmt --write ${nonShell.join(" ")}`] : [];
  },
  "*.{js,jsx,ts,tsx,mjs,cjs}": "yarn lint:fix",
};
