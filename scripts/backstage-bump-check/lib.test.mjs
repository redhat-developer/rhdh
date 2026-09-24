import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  classifyApiChange,
  collectDirectDeps,
  compareVersions,
  configErrorKey,
  diffLines,
  isBreakingRange,
  listTypeFiles,
  listWorkspaceDirs,
  parseConfigCheckOutput,
  parseEntrypointConfigs,
  renderReport,
  resolvePackageDir,
  STATUS,
  sumNumstat,
} from "./lib.mjs";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "bump-check-"));
  tempDirs.push(dir);
  return dir;
}

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
      "Config must be array { type=array } at /catalog/rules",
      "Config must NOT have additional properties { additionalProperty=b } at",
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
    ["config:check exited with status 1", "TypeError: boom"],
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

test("config errors compare by params and path, not ajv wording", () => {
  const base = ["Config must be array { type=array } at /catalog/rules"];
  const reworded = [
    "Config should be an array { type=array } at /catalog/rules",
  ];
  assert.deepEqual(diffLines(base, reworded, configErrorKey), {
    added: [],
    removed: [],
  });

  const newType = ["Config must be string { type=string } at /catalog/rules"];
  assert.deepEqual(diffLines(base, newType, configErrorKey).added, newType);

  // Lines outside the schema-error format keep their full text as identity.
  assert.equal(configErrorKey("Error: boom"), "Error: boom");
  assert.equal(
    configErrorKey(
      "Config must NOT have additional properties { additionalProperty=x } at ",
    ),
    "{ additionalProperty=x } at ",
  );
});

test("classifyApiChange covers every outcome", () => {
  const measure = (added, removed) => () => ({ added, removed });
  const noDiff = () => assert.fail("measureDiff must not be called");
  const both = { baseHasTypes: true, headHasTypes: true };
  const cases = [
    [
      { headVersions: ["1.0.0"], measureDiff: noDiff },
      { status: STATUS.newDependency },
    ],
    [
      { baseVersions: ["1.0.0"], measureDiff: noDiff },
      { status: STATUS.droppedDependency },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["2"],
        baseHasTypes: false,
        headHasTypes: true,
        measureDiff: noDiff,
      },
      { status: STATUS.declarationsAdded },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["2"],
        baseHasTypes: true,
        headHasTypes: false,
        measureDiff: noDiff,
      },
      { status: STATUS.declarationsRemoved },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["2"],
        baseHasTypes: false,
        headHasTypes: false,
        measureDiff: noDiff,
      },
      { status: STATUS.noDeclarations },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["1"],
        baseHasTypes: false,
        headHasTypes: false,
        measureDiff: noDiff,
      },
      { status: STATUS.unchanged },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["2"],
        ...both,
        measureDiff: measure(0, 0),
      },
      { status: STATUS.noDeclarationChange },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["1"],
        ...both,
        measureDiff: measure(0, 0),
      },
      { status: STATUS.unchanged },
    ],
    [
      {
        baseVersions: ["1"],
        headVersions: ["2"],
        ...both,
        measureDiff: measure(3, 1),
      },
      { status: STATUS.changed, added: 3, removed: 1 },
    ],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(classifyApiChange(input), expected, JSON.stringify(input));
  }
});

test("collectDirectDeps and resolvePackageDir follow the workspace layout", () => {
  const root = makeTempDir();
  writeJson(join(root, "package.json"), {
    workspaces: { packages: ["packages/*", "missing/*"] },
    devDependencies: { "@backstage/cli": "1.0.0" },
  });
  writeJson(join(root, "packages/app/package.json"), {
    dependencies: { "@backstage/core": "1.0.0", react: "18.0.0" },
  });
  mkdirSync(join(root, "packages/not-a-package"), { recursive: true });
  writeJson(join(root, "node_modules/@backstage/cli/package.json"), {});
  writeJson(
    join(root, "packages/app/node_modules/@backstage/core/package.json"),
    {},
  );

  const deps = collectDirectDeps(listWorkspaceDirs(root));
  assert.deepEqual(listWorkspaceDirs(root), [root, join(root, "packages/app")]);
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

test("listWorkspaceDirs rejects patterns it cannot expand", () => {
  const root = makeTempDir();
  writeJson(join(root, "package.json"), { workspaces: ["tools/cli"] });
  assert.throws(() => listWorkspaceDirs(root), /Unsupported workspace pattern/);
});

test("listTypeFiles returns declaration files under dist only", () => {
  const dir = makeTempDir();
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
  assert.match(report, /\*\*FAIL\*\*: 1 new error\(s\)/);
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
  assert.equal(isBreakingRange("0.0.1", "0.0.2"), true);
  assert.equal(isBreakingRange("0.0.1", "0.0.1"), false);
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

test("renderReport surfaces versions consolidated on the head side", () => {
  const report = renderReport({
    backstage: { base: "1.0.0", head: "1.0.0" },
    config: { added: [], removed: [], headCount: 0 },
    api: [
      {
        name: "@backstage/errors",
        status: "no declaration change",
        baseVersions: ["1.2.7", "1.3.1"],
        headVersions: ["1.3.1"],
      },
    ],
  });
  assert.match(report, /`@backstage\/errors` \| 1\.2\.7, 1\.3\.1 → 1\.3\.1/);
});

test("compareVersions sorts numerically and puts prereleases first", () => {
  assert.deepEqual(
    ["1.10.0", "1.2.7", "1.10.0-next.1", "0.9.0"].sort(compareVersions),
    ["0.9.0", "1.2.7", "1.10.0-next.1", "1.10.0"],
  );
  assert.deepEqual(["1.2.0-next.10", "1.2.0-next.9"].sort(compareVersions), [
    "1.2.0-next.9",
    "1.2.0-next.10",
  ]);
});
