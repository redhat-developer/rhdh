import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  collectDirectDeps,
  compareVersions,
  diffLines,
  isBreakingRange,
  listTypeFiles,
  listWorkspaceDirs,
  parseConfigCheckOutput,
  parseEntrypointConfigs,
  renderReport,
  resolvePackageDir,
  sumNumstat,
} from "./lib.mjs";

function writeJson(file, value) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

test("parseConfigCheckOutput keeps only the error block, sorted and unique", () => {
  const output = [
    "Loaded config from app-config.yaml",
    "",
    "Error: Configuration does not match schema",
    "",
    "  Config must be array { type=array } at /catalog/rules",
    "  Config must NOT have additional properties { additionalProperty=b } at ",
    "  Config must be array { type=array } at /catalog/rules",
  ].join("\n");
  assert.deepEqual(
    parseConfigCheckOutput({ status: 1, output, rootDir: "/r" }),
    [
      "Config must NOT have additional properties { additionalProperty=b } at",
      "Config must be array { type=array } at /catalog/rules",
      "Error: Configuration does not match schema",
    ],
  );
});

test("parseConfigCheckOutput returns nothing for a clean run", () => {
  assert.deepEqual(
    parseConfigCheckOutput({
      status: 0,
      output: "Loaded config from a.yaml\n",
      rootDir: "/r",
    }),
    [],
  );
});

test("parseConfigCheckOutput masks the checkout path", () => {
  const error = (root) =>
    parseConfigCheckOutput({
      status: 1,
      output: `Error: Failed to read config file at "${root}/app-config.yaml"`,
      rootDir: root,
    });
  assert.deepEqual(error("/tmp/base"), error("/home/runner/work/rhdh"));
  assert.deepEqual(error("/tmp/base"), [
    'Error: Failed to read config file at "<root>/app-config.yaml"',
  ]);
});

test("parseConfigCheckOutput never reports a crash as clean", () => {
  assert.deepEqual(
    parseConfigCheckOutput({
      status: 1,
      output: "TypeError: boom\n",
      rootDir: "/r",
    }),
    ["TypeError: boom", "config:check exited with status 1"],
  );
});

test("parseEntrypointConfigs reads --config arguments in order", () => {
  const containerfile = [
    'ENTRYPOINT ["node", "old"]',
    "USER 1001",
    'ENTRYPOINT ["node", "packages/backend", "--config", "a.yaml", "--config", "b.yaml"]',
  ].join("\n");
  assert.deepEqual(parseEntrypointConfigs(containerfile), ["a.yaml", "b.yaml"]);
  assert.deepEqual(parseEntrypointConfigs("FROM ubi"), []);
});

test("diffLines reports only lines unique to each side", () => {
  assert.deepEqual(diffLines(["a", "b"], ["b", "c"]), {
    added: ["c"],
    removed: ["a"],
  });
});

test("collectDirectDeps and resolvePackageDir follow the workspace layout", () => {
  const root = mkdtempSync(join(tmpdir(), "bump-check-"));
  writeJson(join(root, "package.json"), {
    workspaces: { packages: ["packages/*"] },
    devDependencies: { "@backstage/cli": "1.0.0" },
  });
  writeJson(join(root, "packages/app/package.json"), {
    dependencies: { "@backstage/core": "1.0.0", react: "18.0.0" },
  });
  writeJson(join(root, "node_modules/@backstage/cli/package.json"), {});
  writeJson(
    join(root, "packages/app/node_modules/@backstage/core/package.json"),
    {},
  );

  const deps = collectDirectDeps(listWorkspaceDirs(root));
  assert.deepEqual([...deps.keys()], ["@backstage/cli", "@backstage/core"]);

  const [appDir] = deps.get("@backstage/core");
  assert.equal(
    resolvePackageDir(root, appDir, "@backstage/core"),
    join(root, "packages/app/node_modules/@backstage/core"),
  );
  assert.equal(
    resolvePackageDir(root, appDir, "@backstage/cli"),
    join(root, "node_modules/@backstage/cli"),
  );
  assert.equal(
    resolvePackageDir(root, appDir, "@backstage/missing"),
    undefined,
  );
});

test("listTypeFiles returns declaration files under dist only", () => {
  const dir = mkdtempSync(join(tmpdir(), "bump-check-"));
  mkdirSync(join(dir, "dist/sub"), { recursive: true });
  writeFileSync(join(dir, "dist/index.d.ts"), "");
  writeFileSync(join(dir, "dist/sub/alpha.d.ts"), "");
  writeFileSync(join(dir, "dist/index.cjs.js"), "");
  assert.deepEqual(listTypeFiles(dir), [
    "dist/index.d.ts",
    "dist/sub/alpha.d.ts",
  ]);
  assert.deepEqual(listTypeFiles(join(dir, "nope")), []);
});

test("sumNumstat ignores binary entries", () => {
  assert.deepEqual(sumNumstat("3\t1\ta\n-\t-\tb\n2\t0\tc\n"), {
    added: 5,
    removed: 1,
  });
});

test("renderReport flags new config errors and lists changed packages", () => {
  const report = renderReport({
    backstage: { base: "1.0.0", head: "1.1.0" },
    config: { added: ["Config must be array"], removed: [], headCount: 2 },
    api: [
      { name: "@backstage/a", status: "unchanged" },
      {
        name: "@backstage/c",
        status: "no declaration change",
        baseVersions: ["1.0.0"],
        headVersions: ["1.0.1"],
      },
      {
        name: "@backstage/b",
        status: "changed",
        baseVersions: ["0.1.0"],
        headVersions: ["0.2.0"],
        added: 4,
        removed: 2,
      },
    ],
  });
  assert.match(report, /\*\*FAIL\*\*: 1 new error line/);
  assert.match(
    report,
    /\| `@backstage\/b` \| 0\.1\.0 → 0\.2\.0 \(breaking range\) \| \+4 \/ -2 \|/,
  );
  assert.doesNotMatch(report, /@backstage\/[ac]/);
  assert.match(
    report,
    /1 other package\(s\) changed version .*; 1 are unchanged/,
  );
});

test("isBreakingRange follows caret semantics", () => {
  assert.equal(isBreakingRange("3.9.1", "4.0.0"), true);
  assert.equal(isBreakingRange("0.17.8", "0.18.0"), true);
  assert.equal(isBreakingRange("1.10.0", "1.11.0"), false);
  assert.equal(isBreakingRange("0.17.8", "0.17.9"), false);
});

test("renderReport surfaces workspaces that resolve several versions", () => {
  const report = renderReport({
    backstage: { base: "1.0.0", head: "1.0.0" },
    config: { added: [], removed: [], headCount: 0 },
    api: [
      {
        name: "@backstage/errors",
        status: "unchanged",
        baseVersions: ["1.3.1"],
        headVersions: ["1.2.7", "1.3.1"],
      },
    ],
  });
  assert.match(
    report,
    /\| `@backstage\/errors` \| 1\.3\.1 → 1\.2\.7, 1\.3\.1 \| unchanged \(multiple versions, newest compared\) \|/,
  );
});

test("compareVersions sorts numerically and puts prereleases first", () => {
  assert.deepEqual(
    ["1.10.0", "1.2.7", "1.10.0-next.1", "0.9.0"].sort(compareVersions),
    ["0.9.0", "1.2.7", "1.10.0-next.1", "1.10.0"],
  );
});
