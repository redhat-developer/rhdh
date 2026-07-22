// @ts-check

/** @type {import("prettier").Config} */
module.exports = {
  plugins: ["prettier-plugin-sh"],
  overrides: [
    {
      files: "*.sh",
      options: {
        parser: "sh",
        keepComments: true,
        indent: 2,
        endOfLine: "lf",
      },
    },
  ],
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",
};
