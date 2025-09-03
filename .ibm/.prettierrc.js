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
        endOfLine: 'lf',
      },
    },
    {
      files: '*.md',
      options: {
        parser: 'markdown',
        // Markdown specific formatting options
        tabWidth: 2,
        useTabs: false,
        proseWrap: 'always',
        endOfLine: 'lf',
      },
    },
    {
      files: '*.{yaml,yml}',
      options: {
        parser: 'yaml',
        // YAML specific formatting options
        tabWidth: 2,
        useTabs: false,
        endOfLine: 'lf',
      },
    },
  ],
  // General Prettier options
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'avoid',
  endOfLine: 'lf',
};
