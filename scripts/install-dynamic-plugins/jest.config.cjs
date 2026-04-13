/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 20000,
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
  // Strip the `.js` extension from relative imports so that NodeNext-style
  // ESM-spec'd imports (`./foo.js`) resolve to the `.ts` source under Jest.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
};
