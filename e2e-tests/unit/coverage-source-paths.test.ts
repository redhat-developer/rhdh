import { describe, expect, it } from "vitest";

import { isAppBundle, isAppSource, toRepoPath } from "../playwright/support/coverage/source-paths";

// Shapes taken from a real run against quay.io/rhdh-community/rhdh:next: monocart
// unpacks `webpack://app/./src/App.tsx` into `app/src/App.tsx`.
describe("toRepoPath", () => {
  it.each([
    ["app/src/App.tsx", "packages/app/src/App.tsx"],
    ["app/src/modules/catalog/index.tsx", "packages/app/src/modules/catalog/index.tsx"],
  ])("maps %s onto its repository path", (sourcePath, expected) => {
    expect(toRepoPath(sourcePath)).toBe(expected);
  });

  it.each(["app/node_modules/yaml/dist/index.js", "packages/app/src/App.tsx"])(
    "leaves %s untouched",
    (sourcePath) => {
      expect(toRepoPath(sourcePath)).toBe(sourcePath);
    },
  );
});

describe("isAppSource", () => {
  // monocart rewrites the path before filtering, so both forms reach isAppSource.
  it.each(["app/src/App.tsx", "packages/app/src/App.tsx"])("keeps %s", (sourcePath) => {
    expect(isAppSource(sourcePath)).toBe(true);
  });

  it.each([
    "app/node_modules/@backstage/core-components/dist/index.esm.js",
    "app/webpack/runtime/load_script",
    "app/json/opt/app-root/src/packages/app/package.json",
    "localhost-7007/static/main.fced3a21418e.js",
  ])("drops %s", (sourcePath) => {
    expect(isAppSource(sourcePath)).toBe(false);
  });
});

describe("isAppBundle", () => {
  it("keeps bundles served from the app's /static/ path", () => {
    expect(isAppBundle({ url: "https://rhdh.example.com/static/main.fced3a21.js" })).toBe(true);
  });

  it.each([
    "https://rhdh.example.com/api/scalprum/plugin/remoteEntry.js",
    "https://rhdh.example.com/assets/static/main.js",
    "not a url",
  ])("drops %s", (url) => {
    expect(isAppBundle({ url })).toBe(false);
  });
});
