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
  return [...new Set(errors)].sort();
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

export function diffLines(base, head) {
  const baseSet = new Set(base);
  const headSet = new Set(head);
  return {
    added: head.filter((line) => !baseSet.has(line)),
    removed: base.filter((line) => !headSet.has(line)),
  };
}

export function listWorkspaceDirs(rootDir) {
  const rootPkg = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf8"),
  );
  const patterns = rootPkg.workspaces?.packages ?? rootPkg.workspaces ?? [];
  const dirs = [rootDir];
  for (const pattern of patterns) {
    // Only "<dir>/*" patterns are used in this repo.
    const parent = join(rootDir, pattern.replace(/\/\*$/, ""));
    if (!existsSync(parent)) {
      continue;
    }
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const dir = join(parent, entry.name);
      if (entry.isDirectory() && existsSync(join(dir, "package.json"))) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

/** Maps each directly declared dependency matching `prefix` to the workspaces declaring it. */
export function collectDirectDeps(workspaceDirs, prefix = "@backstage/") {
  const deps = new Map();
  for (const dir of workspaceDirs) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (name.startsWith(prefix)) {
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
  const [aCore, aPre] = String(a).split("-", 2);
  const [bCore, bPre] = String(b).split("-", 2);
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
  if (aPre === undefined || bPre === undefined) {
    return aPre === undefined ? 1 : -1;
  }
  return aPre.localeCompare(bPre);
}

/** True when `to` is outside the caret range of `from` (major, or minor while 0.x). */
export function isBreakingRange(from, to) {
  const [fromMajor, fromMinor] = String(from).split(".").map(Number);
  const [toMajor, toMinor] = String(to).split(".").map(Number);
  if (fromMajor !== toMajor) {
    return true;
  }
  return fromMajor === 0 && fromMinor !== toMinor;
}

// Rows worth a reviewer's attention; version-only bumps are just counted.
const REPORTED_STATUSES = new Set([
  "changed",
  "new dependency",
  "dropped dependency",
  "declarations added",
  "declarations removed",
]);

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
  return REPORTED_STATUSES.has(entry.status) || entry.headVersions?.length > 1;
}

function codeBlock(lines) {
  return ["```text", ...lines, "```"].join("\n");
}

export function renderReport({ backstage, config, api }) {
  const out = ["## Backstage bump checks", ""];
  out.push(`Backstage \`${backstage.base}\` → \`${backstage.head}\``, "");

  out.push(
    "### Config schema",
    "",
    "`backstage-cli config:check --strict` against the app-config files the image loads, compared with the base branch.",
    "",
  );
  if (config.added.length > 0) {
    out.push(
      `**FAIL**: ${config.added.length} new error line(s) introduced by this change:`,
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
    (entry) => !isReported(entry) && entry.status !== "unchanged",
  ).length;
  if (reported.length === 0) {
    out.push("No changes to the published type declarations.", "");
  } else {
    out.push(
      "| Package | Version | Declaration lines |",
      "| --- | --- | --- |",
      ...reported.map((entry) => {
        const status =
          entry.status === "changed"
            ? `+${entry.added} / -${entry.removed}`
            : entry.status;
        const lines =
          entry.headVersions?.length > 1
            ? `${status} (multiple versions, newest compared)`
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
