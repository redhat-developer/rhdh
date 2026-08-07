// @ts-check

/** @type {import("@ianvs/prettier-plugin-sort-imports").PrettierConfig} */
module.exports = {
  ...require('@backstage/cli/config/prettier.json'),
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
  importOrder: [
    '^react(.*)$',
    '',
    '^@backstage/(.*)$',
    '',
    '<THIRD_PARTY_MODULES>',
    '',
    '^@janus-idp/(.*)$',
    '',
    '<BUILTIN_MODULES>',
    '',
    '^[.]',
  ],
};
