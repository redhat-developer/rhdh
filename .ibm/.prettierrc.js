// @ts-check

/** @type {import("prettier").Config} */
module.exports = {
  plugins: ['prettier-plugin-sh'],
  overrides: [
    {
      files: '*.sh',
      options: {
        parser: 'sh',
        // Shell script specific formatting options
        keepComments: true,
        indent: 2,
        // Ensure consistent line endings
        endOfLine: 'lf',
      },
    },
  ],
  // General Prettier options
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'avoid',
  endOfLine: 'lf',
};
