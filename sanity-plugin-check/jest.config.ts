import type { Config } from "jest";
import path from "path";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 60_000,
  rootDir: "src",
  testMatch: ["**/*.test.ts"],
  verbose: true,
  // Add test package's node_modules to Jest's module resolution
  // so extracted OCI plugins can find peer deps like @backstage/backend-plugin-api
  modulePaths: [path.resolve(__dirname, "node_modules")],
};

export default config;
