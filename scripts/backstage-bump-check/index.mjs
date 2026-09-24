#!/usr/bin/env node

/**
 * Detects breakage introduced by a Backstage dependency bump.
 * See scripts/backstage-bump-check/README.md.
 *
 * Usage:
 *   node scripts/backstage-bump-check/index.mjs snapshot <dir>
 *   node scripts/backstage-bump-check/index.mjs compare <baseDir> <headDir> <reportDir>
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  classifyApiChange,
  collectDirectDeps,
  compareVersions,
  configErrorKey,
  diffLines,
  listTypeFiles,
  listWorkspaceDirs,
  parseConfigCheckOutput,
  parseEntrypointConfigs,
  renderReport,
  resolutionPairs,
  resolvePackageDir,
  STATUS,
  sumNumstat,
} from "./lib.mjs";

const CONTAINERFILE = "build/containerfiles/Containerfile";
const DEFAULT_CONFIG_FILES = ["app-config.yaml"];

// Each checkout validates the config files its own image loads.
function imageConfigFiles(rootDir) {
  const containerfile = join(rootDir, CONTAINERFILE);
  const files = existsSync(containerfile)
    ? parseEntrypointConfigs(readFileSync(containerfile, "utf8"))
    : [];
  if (files.length === 0) {
    console.warn(
      `No --config in the ${CONTAINERFILE} ENTRYPOINT, using ${DEFAULT_CONFIG_FILES}`,
    );
    return DEFAULT_CONFIG_FILES;
  }
  return files;
}

// Declarations are stored per resolved version, and the version each
// workspace resolves is recorded, since workspaces may differ.
function snapshotDeclarations(rootDir, outDir) {
  const versions = {};
  const resolutions = {};
  const deps = collectDirectDeps(listWorkspaceDirs(rootDir));
  for (const [name, workspaceDirs] of deps) {
    const resolved = new Set();
    resolutions[name] = {};
    for (const workspaceDir of workspaceDirs) {
      const packageDir = resolvePackageDir(rootDir, workspaceDir, name);
      if (!packageDir) {
        console.warn(`Could not resolve ${name} from ${workspaceDir}`);
        continue;
      }
      const { version } = JSON.parse(
        readFileSync(join(packageDir, "package.json"), "utf8"),
      );
      resolutions[name][relative(rootDir, workspaceDir) || "."] = version;
      if (resolved.has(version)) {
        continue;
      }
      resolved.add(version);
      for (const file of listTypeFiles(packageDir)) {
        cpSync(
          join(packageDir, file),
          join(outDir, "api", name, version, file),
        );
      }
    }
    if (resolved.size > 0) {
      versions[name] = [...resolved].sort(compareVersions);
    }
  }
  return { versions, resolutions };
}

function snapshot(outDir) {
  // Not the script's repo: CI runs this copy against the base worktree too.
  const rootDir = process.cwd();
  mkdirSync(outDir, { recursive: true });

  const configFiles = imageConfigFiles(rootDir);
  const check = spawnSync(
    join(rootDir, "node_modules/.bin/backstage-cli"),
    [
      "config:check",
      "--lax",
      "--strict",
      ...configFiles.flatMap((f) => ["--config", f]),
    ],
    { encoding: "utf8" },
  );
  if (check.error) {
    throw check.error;
  }
  const configErrors = parseConfigCheckOutput({
    status: check.status,
    output: `${check.stdout}\n${check.stderr}`,
    rootDir,
  });
  writeFileSync(
    join(outDir, "config-errors.txt"),
    configErrors.map((line) => `${line}\n`).join(""),
  );

  const { versions, resolutions } = snapshotDeclarations(rootDir, outDir);

  const backstageJson = join(rootDir, "backstage.json");
  const backstage = existsSync(backstageJson)
    ? JSON.parse(readFileSync(backstageJson, "utf8")).version
    : "unknown";
  writeFileSync(
    join(outDir, "versions.json"),
    `${JSON.stringify({ backstage, configFiles, packages: versions, resolutions }, null, 2)}\n`,
  );
  console.log(
    `Snapshot written to ${outDir}: ${configErrors.length} config error line(s) for ${configFiles.join(", ")}; ${Object.keys(versions).length} package(s)`,
  );
}

function readLines(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

// Resolved from fixed system directories rather than PATH.
const GIT_CANDIDATES = [
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

function findGit() {
  const git = GIT_CANDIDATES.find((path) => existsSync(path));
  if (!git) {
    throw new Error(`git not found in ${GIT_CANDIDATES.join(", ")}`);
  }
  return git;
}

function gitDiff(args, cwd) {
  // --no-index exits 1 when the inputs differ.
  const result = spawnSync(findGit(), ["diff", "--no-index", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git diff failed: ${result.stderr}`);
  }
  return result.stdout;
}

function compare(baseDir, headDir, reportDir) {
  mkdirSync(reportDir, { recursive: true });
  // Diff from the common parent so patch paths read base/... and head/...
  const cwd = dirname(resolve(baseDir));
  const baseRel = relative(cwd, resolve(baseDir));
  const headRel = relative(cwd, resolve(headDir));

  const baseErrors = readLines(join(baseDir, "config-errors.txt"));
  const headErrors = readLines(join(headDir, "config-errors.txt"));
  const config = {
    ...diffLines(baseErrors, headErrors, configErrorKey),
    headCount: headErrors.length,
  };

  const baseVersions = JSON.parse(
    readFileSync(join(baseDir, "versions.json"), "utf8"),
  );
  const headVersions = JSON.parse(
    readFileSync(join(headDir, "versions.json"), "utf8"),
  );
  const names = [
    ...new Set([
      ...Object.keys(baseVersions.packages),
      ...Object.keys(headVersions.packages),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const patches = [];
  const api = names.map((name) => {
    const entry = {
      name,
      baseVersions: baseVersions.packages[name],
      headVersions: headVersions.packages[name],
    };
    const pairs = resolutionPairs({
      ...entry,
      baseResolutions: baseVersions.resolutions?.[name],
      headResolutions: headVersions.resolutions?.[name],
    }).map(([baseVersion, headVersion]) => {
      const baseApi = join(baseRel, "api", name, baseVersion);
      const headApi = join(headRel, "api", name, headVersion);
      return {
        baseApi,
        headApi,
        baseHasTypes: existsSync(join(cwd, baseApi)),
        headHasTypes: existsSync(join(cwd, headApi)),
        measureDiff: () =>
          sumNumstat(gitDiff(["--numstat", baseApi, headApi], cwd)),
      };
    });
    const change = classifyApiChange({ ...entry, pairs });
    if (change.status === STATUS.changed) {
      for (const pair of pairs.filter((p) => p.headHasTypes)) {
        patches.push(gitDiff([pair.baseApi, pair.headApi], cwd));
      }
    }
    return { ...entry, ...change };
  });

  writeFileSync(join(reportDir, "api-surface.diff"), patches.join(""));
  const report = renderReport({
    backstage: { base: baseVersions.backstage, head: headVersions.backstage },
    config,
    api,
  });
  writeFileSync(join(reportDir, "summary.md"), report);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
  if (config.added.length > 0) {
    process.exitCode = 1;
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === "snapshot" && args.length === 1) {
  snapshot(args[0]);
} else if (command === "compare" && args.length === 3) {
  compare(...args);
} else {
  console.error(
    "Usage: index.mjs snapshot <dir> | compare <baseDir> <headDir> <reportDir>",
  );
  process.exit(2);
}
