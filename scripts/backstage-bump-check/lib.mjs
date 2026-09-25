import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Extracts the error lines printed by `backstage-cli config:check`.
 * Returns a sorted, de-duplicated list so two runs can be compared as sets.
 * `rootDir` is masked so snapshots taken in different checkouts compare equal.
 */
export function parseConfigCheckOutput({ status, output, rootDir }) {
  if (status === 0) {
    return [];
  }
  const lines = output
    .replaceAll(`${rootDir}/`, "<root>/")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => line.startsWith("Error:"));
  // A failure without the usual error block (e.g. a crash) must never read as clean.
  const errors =
    start === -1
      ? [`config:check exited with status ${status}`, ...lines]
      : lines.slice(start);
  return [...new Set(errors)].sort((a, b) => a.localeCompare(b));
}

/** Reads the `--config` arguments from a Containerfile ENTRYPOINT in exec form. */
export function parseEntrypointConfigs(containerfile) {
  const entrypoint = containerfile
    .split("\n")
    .findLast((line) => /^ENTRYPOINT\s+\[/.test(line));
  if (!entrypoint) {
    return [];
  }
  const args = JSON.parse(entrypoint.replace(/^ENTRYPOINT\s+/, ""));
  return args.flatMap((arg, i) => (args[i - 1] === "--config" ? [arg] : []));
}

/**
 * Identity of a schema error: its params and config path, e.g.
 * `{ additionalProperty=foo } at /app`. The ajv wording in front can change
 * between @backstage/config-loader versions without the error changing.
 */
export function configErrorKey(line) {
  const open = line.indexOf(" {");
  const close = line.lastIndexOf("} at");
  if (!line.startsWith("Config ") || open === -1 || close < open) {
    return line;
  }
  const params = line.slice(open + 1, close + 1);
  const path = line.slice(close + "} at".length).trim();
  return `${params} at ${path}`;
}

export function diffLines(base, head, key = (line) => line) {
  const baseKeys = new Set(base.map(key));
  const headKeys = new Set(head.map(key));
  return {
    added: head.filter((line) => !baseKeys.has(key(line))),
    removed: base.filter((line) => !headKeys.has(key(line))),
  };
}

export function listWorkspaceDirs(rootDir) {
  const rootPkg = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf8"),
  );
  const patterns = rootPkg.workspaces?.packages ?? rootPkg.workspaces ?? [];
  const dirs = [rootDir];
  for (const pattern of patterns) {
    // The repo only uses "<dir>/*"; fail loudly rather than skip workspaces.
    if (!pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    const parent = join(rootDir, pattern.slice(0, -2));
    if (!existsSync(parent)) {
      continue;
    }
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      dirs.push(join(parent, entry.name));
    }
  }
  return dirs.filter((dir) => existsSync(join(dir, "package.json")));
}

const SCOPE = "@backstage/";

/** Maps each directly declared `@backstage/*` dependency to the workspaces declaring it. */
export function collectDirectDeps(workspaceDirs) {
  const deps = new Map();
  for (const dir of workspaceDirs) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (name.startsWith(SCOPE)) {
          deps.set(name, [...(deps.get(name) ?? []), dir]);
        }
      }
    }
  }
  return new Map([...deps].sort(([a], [b]) => a.localeCompare(b)));
}

/** Resolves a package the way the node-modules linker lays it out. */
export function resolvePackageDir(rootDir, workspaceDir, name) {
  for (const base of [workspaceDir, rootDir]) {
    const dir = join(base, "node_modules", name);
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
  }
  return undefined;
}

export function listTypeFiles(packageDir) {
  const distDir = join(packageDir, "dist");
  if (!existsSync(distDir)) {
    return [];
  }
  return readdirSync(distDir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".d.ts"))
    .map((file) => join("dist", file))
    .sort();
}

/** Sums `git diff --numstat` output into added/removed line counts. */
export function sumNumstat(output) {
  let added = 0;
  let removed = 0;
  for (const line of output.split("\n")) {
    const [a, r] = line.split("\t");
    if (/^\d+$/.test(a) && /^\d+$/.test(r)) {
      added += Number(a);
      removed += Number(r);
    }
  }
  return { added, removed };
}

/** Orders `major.minor.patch[-pre]` versions; a prerelease sorts before its release. */
export function compareVersions(a, b) {
  // An empty prerelease means a release version.
  const [aCore, aPre = ""] = String(a).split("-", 2);
  const [bCore, bPre = ""] = String(b).split("-", 2);
  const aParts = aCore.split(".").map(Number);
  const bParts = bCore.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((aParts[i] ?? 0) !== (bParts[i] ?? 0)) {
      return (aParts[i] ?? 0) - (bParts[i] ?? 0);
    }
  }
  if (aPre === bPre) {
    return 0;
  }
  if (!aPre || !bPre) {
    return aPre ? -1 : 1;
  }
  // Numeric so next.10 sorts after next.9.
  return aPre.localeCompare(bPre, undefined, { numeric: true });
}

/** True when `to` is outside the caret range of `from`: ^1.2.3, ^0.2.3 and ^0.0.3 differ. */
export function isBreakingRange(from, to) {
  const [fromMajor, fromMinor, fromPatch] = String(from).split(".").map(Number);
  const [toMajor, toMinor, toPatch] = String(to).split(".").map(Number);
  if (fromMajor !== toMajor) {
    return true;
  }
  if (fromMajor !== 0) {
    return false;
  }
  return fromMinor !== toMinor || (fromMinor === 0 && fromPatch !== toPatch);
}

export const STATUS = {
  changed: "changed",
  newDependency: "new dependency",
  droppedDependency: "dropped dependency",
  declarationsAdded: "declarations added",
  declarationsRemoved: "declarations removed",
  noDeclarations: "no declarations",
  noDeclarationChange: "no declaration change",
  unchanged: "unchanged",
};

// Rows worth a reviewer's attention; version-only bumps are just counted.
const REPORTED_STATUSES = new Set([
  STATUS.changed,
  STATUS.newDependency,
  STATUS.droppedDependency,
  STATUS.declarationsAdded,
  STATUS.declarationsRemoved,
]);

/**
 * Version pairs to diff for one package: every (base, head) resolution a
 * workspace moved between. `resolutions` map workspace -> version. When no
 * workspace moved (e.g. only a workspace was added), falls back to the newest
 * version on each side.
 */
export function resolutionPairs({
  baseResolutions = {},
  headResolutions = {},
  baseVersions,
  headVersions,
}) {
  const pairs = new Map();
  for (const [workspace, headVersion] of Object.entries(headResolutions)) {
    const baseVersion = baseResolutions[workspace];
    if (baseVersion && baseVersion !== headVersion) {
      pairs.set(`${baseVersion}\0${headVersion}`, [baseVersion, headVersion]);
    }
  }
  if (pairs.size === 0 && baseVersions && headVersions) {
    const [base, head] = [baseVersions.at(-1), headVersions.at(-1)];
    if (base !== head) {
      pairs.set(`${base}\0${head}`, [base, head]);
    }
  }
  return [...pairs.values()];
}

/**
 * Decides how one package's API changed between base and head. `pairs` are
 * the version pairs from resolutionPairs, each with whether both sides ship
 * declarations; `measureDiff` is only called when both do.
 */
export function classifyApiChange({ baseVersions, headVersions, pairs }) {
  if (!baseVersions) {
    return { status: STATUS.newDependency };
  }
  if (!headVersions) {
    return { status: STATUS.droppedDependency };
  }
  if (pairs.length === 0) {
    const sameVersions = baseVersions.join() === headVersions.join();
    return {
      status: sameVersions ? STATUS.unchanged : STATUS.noDeclarationChange,
    };
  }
  const mismatch = pairs.find((p) => p.baseHasTypes !== p.headHasTypes);
  if (mismatch) {
    return {
      status: mismatch.headHasTypes
        ? STATUS.declarationsAdded
        : STATUS.declarationsRemoved,
    };
  }
  const typed = pairs.filter((p) => p.headHasTypes);
  if (typed.length === 0) {
    return { status: STATUS.noDeclarations };
  }
  let added = 0;
  let removed = 0;
  for (const pair of typed) {
    const diff = pair.measureDiff();
    added += diff.added;
    removed += diff.removed;
  }
  if (added + removed === 0) {
    return { status: STATUS.noDeclarationChange };
  }
  return { status: STATUS.changed, added, removed };
}

function hasMultipleVersions({ baseVersions, headVersions }) {
  return baseVersions?.length > 1 || headVersions?.length > 1;
}

function formatVersion({ baseVersions, headVersions }) {
  const range = `${baseVersions?.join(", ") || "-"} → ${headVersions?.join(", ") || "-"}`;
  return baseVersions?.length &&
    headVersions?.length &&
    isBreakingRange(baseVersions.at(-1), headVersions.at(-1))
    ? `${range} (breaking range)`
    : range;
}

// Workspaces resolving different versions see different APIs; always surface it.
function isReported(entry) {
  return REPORTED_STATUSES.has(entry.status) || hasMultipleVersions(entry);
}

function codeBlock(lines) {
  return ["```text", ...lines, "```"].join("\n");
}

export function renderReport({ backstage, config, api }) {
  const out = [
    "## Backstage bump checks",
    "",
    `Backstage \`${backstage.base}\` → \`${backstage.head}\``,
    "",
    "### Config schema",
    "",
    "`backstage-cli config:check --strict` against the app-config files the image loads, compared with the base branch.",
    "",
  ];
  if (config.added.length > 0) {
    out.push(
      `**FAIL**: ${config.added.length} new error(s) introduced by this change:`,
      "",
      codeBlock(config.added),
      "",
    );
  } else {
    out.push(
      `**PASS**: no new errors (${config.headCount} pre-existing line(s) unchanged).`,
      "",
    );
  }
  if (config.removed.length > 0) {
    out.push(
      `${config.removed.length} error line(s) no longer reported:`,
      "",
      codeBlock(config.removed),
      "",
    );
  }

  out.push("### API surface of direct `@backstage/*` dependencies", "");
  const reported = api.filter(isReported);
  const bumpedOnly = api.filter(
    (entry) => !isReported(entry) && entry.status !== STATUS.unchanged,
  ).length;
  if (reported.length === 0) {
    out.push("No changes to the published type declarations.", "");
  } else {
    out.push(
      "| Package | Version | Declaration lines |",
      "| --- | --- | --- |",
      ...reported.map((entry) => {
        const status =
          entry.status === STATUS.changed
            ? `+${entry.added} / -${entry.removed}`
            : entry.status;
        const lines = hasMultipleVersions(entry)
          ? `${status} (multiple versions)`
          : status;
        return `| \`${entry.name}\` | ${formatVersion(entry)} | ${lines} |`;
      }),
      "",
    );
  }
  out.push(
    `${bumpedOnly} other package(s) changed version without changing their declarations; ${api.length - reported.length - bumpedOnly} are unchanged. The full diff is \`api-surface.diff\` in the \`backstage-bump-report\` artifact.`,
    "",
  );
  return out.join("\n");
}
