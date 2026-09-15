#!/usr/bin/env node

/**
 * Generates eol-dependency-inventory.csv and
 * eol-dependency-inventory-report.md in this folder.
 * See scripts/eol-inventory/README.md for how to run this.
 *
 * Scope: root + packages/* + plugins/*,
 * plus generally-available and tech-preview plugins from overlays metadata.
 *
 * Usage:
 *   yarn eol-inventory
 *   OVERLAYS_REF=<git-ref> yarn eol-inventory
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
process.chdir(repoRoot);

const UNMAINTAINED_MONTHS = 18;
const STALE_MONTHS_LONG = 36;
const UNMAINTAINED_BEFORE = addMonths(new Date(), -UNMAINTAINED_MONTHS);
const STALE_LONG_BEFORE = addMonths(new Date(), -STALE_MONTHS_LONG);

const OUTPUT_CSV = join(__dirname, "eol-dependency-inventory.csv");
const OUTPUT_MD = join(__dirname, "eol-dependency-inventory-report.md");
const OVERLAY_SUPPORT = new Set(["generally-available", "tech-preview"]);
const OVERLAYS_REPO = "redhat-developer/rhdh-plugin-export-overlays";
const OVERLAYS_REF = process.env.OVERLAYS_REF || "main";
const OVERLAY_METADATA_PATH =
  /^workspaces\/[^/]+\/metadata\/[^/]+\.ya?ml$/;
const npmPackuments = new Map();

const STATUS_ORDER = {
  unmaintained: 0,
  unknown: 1,
  OK: 2,
};

const IMPACT_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
};

const CSV_COLUMNS = [
  "status",
  "status_order",
  "impact",
  "impact_order",
  "workspace",
  "plugin",
  "support",
  "name",
  "version",
  "ecosystem",
  "dep_type",
  "tree",
  "risk",
  "last_publish",
  "deprecated",
  "declared_in",
  "notes",
];

const TEST_NAME =
  /(?:^@types\/|jest|testing-library|test-utils|jsdom|@jest\/)/i;

function addMonths(date, months) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function isoDate(value) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function workspaceFromPath(declaredIn) {
  return declaredIn.match(/^workspaces\/([^/]+)\//)?.[1];
}

function pluginLabel(declaredIn, tree) {
  if (tree === "overlays") {
    return declaredIn.match(/metadata\/([^/]+)\.ya?ml$/)?.[1] ?? declaredIn;
  }
  if (declaredIn === "package.json" || declaredIn.startsWith("package.json ")) {
    return "root";
  }
  return (
    declaredIn.match(/^(?:packages|plugins)\/([^/]+)\//)?.[1] ?? declaredIn
  );
}

function sourceFields(declaredIn, tree, support = "") {
  return {
    declaredIn,
    support: support || "",
    workspace:
      tree === "overlays"
        ? (workspaceFromPath(declaredIn) ?? "")
        : "rhdh-core",
    plugin: pluginLabel(declaredIn, tree),
  };
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function listCorePackageJsons() {
  const files = ["package.json"];
  for (const dir of ["packages", "plugins"]) {
    const dirPath = join(repoRoot, dir);
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pkgPath = join(dir, entry.name, "package.json");
      if (existsSync(join(repoRoot, pkgPath))) {
        files.push(pkgPath);
      }
    }
  }
  return files;
}

function collectNpmDeclarations() {
  /** @type {Map<string, object>} */
  const rows = new Map();

  function add(name, version, depType, declaredIn) {
    if (!name || version.startsWith("workspace:")) {
      return;
    }
    const key = `npm|${name}|${version}|${depType}|${declaredIn}`;
    if (rows.has(key)) {
      return;
    }
    rows.set(key, {
      ecosystem: "npm",
      name,
      version,
      depType,
      tree: "root-workspace",
      ...sourceFields(declaredIn, "root-workspace"),
    });
  }

  for (const relativePath of listCorePackageJsons()) {
    const pkg = JSON.parse(readFileSync(relativePath, "utf8"));
    for (const [depType, deps] of [
      ["dependencies", pkg.dependencies],
      ["devDependencies", pkg.devDependencies],
      ["peerDependencies", pkg.peerDependencies],
    ]) {
      for (const [name, version] of Object.entries(deps ?? {})) {
        add(name, version, depType, relativePath);
      }
    }
    if (pkg.resolutions) {
      for (const [name, version] of Object.entries(pkg.resolutions)) {
        add(name, version, "resolutions", relativePath);
      }
    }
  }

  return [...rows.values()];
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function yamlScalar(text, key) {
  const match = text.match(
    new RegExp(String.raw`^\s+${key}:\s*(?:['"]([^'"]+)['"]|(\S+))`, "m"),
  );
  return (match?.[1] ?? match?.[2] ?? "").trim() || undefined;
}

function parseOverlayPlugin(relative, text) {
  const packageName = yamlScalar(text, "packageName");
  const version = yamlScalar(text, "version");
  const support = yamlScalar(text, "support");
  if (!packageName || !version || !OVERLAY_SUPPORT.has(support)) {
    return undefined;
  }
  return {
    packageName,
    version,
    support,
    declaredIn: relative,
  };
}

async function listOverlayMetadataPathsFromGitHub() {
  const headers = githubHeaders();
  const tree = await fetchJson(
    `https://api.github.com/repos/${OVERLAYS_REPO}/git/trees/${encodeURIComponent(OVERLAYS_REF)}?recursive=1`,
    headers,
  );
  if (tree?.tree && !tree.truncated) {
    return tree.tree
      .filter(
        (entry) => entry.type === "blob" && OVERLAY_METADATA_PATH.test(entry.path),
      )
      .map((entry) => entry.path);
  }

  const workspaces = await fetchJson(
    `https://api.github.com/repos/${OVERLAYS_REPO}/contents/workspaces?ref=${encodeURIComponent(OVERLAYS_REF)}`,
    headers,
  );
  const paths = [];
  for (const workspace of workspaces ?? []) {
    if (workspace.type !== "dir") {
      continue;
    }
    const files = await fetchJson(
      `https://api.github.com/repos/${OVERLAYS_REPO}/contents/workspaces/${workspace.name}/metadata?ref=${encodeURIComponent(OVERLAYS_REF)}`,
      headers,
    );
    for (const file of files ?? []) {
      if (file.type === "file" && /\.ya?ml$/.test(file.name)) {
        paths.push(file.path);
      }
    }
  }
  return paths;
}

async function listOverlayPluginsFromGitHub() {
  const paths = await listOverlayMetadataPathsFromGitHub();
  const plugins = [];
  await mapPool(paths, 8, async (relative) => {
    const text = await fetchText(
      `https://raw.githubusercontent.com/${OVERLAYS_REPO}/${OVERLAYS_REF}/${relative}`,
    );
    const plugin = parseOverlayPlugin(relative, text ?? "");
    if (plugin) {
      plugins.push(plugin);
    }
  });
  return plugins;
}

function npmLookupName(name) {
  const nested = name.match(/@npm:[^/]+\/(.+)$/);
  if (nested) {
    return nested[1];
  }
  return name;
}

async function getNpmPackument(name) {
  const lookupName = npmLookupName(name);
  const encoded = encodeURIComponent(lookupName).replaceAll("%40", "@");
  const url = `https://registry.npmjs.org/${encoded}`;
  if (!npmPackuments.has(url)) {
    npmPackuments.set(url, fetchJson(url));
  }
  return npmPackuments.get(url);
}

async function collectOverlayDeclarations() {
  const plugins = await listOverlayPluginsFromGitHub();
  const source = `https://github.com/${OVERLAYS_REPO}/tree/${OVERLAYS_REF}`;
  console.log(`Found ${plugins.length} GA/TP overlay plugins in ${source}`);

  const rows = new Map();
  function add(name, version, depType, declaredIn, support) {
    if (!name || String(version).startsWith("workspace:")) {
      return;
    }
    const versionText = String(version);
    const key = `npm|${name}|${versionText}|${depType}|${declaredIn}`;
    if (rows.has(key)) {
      return;
    }
    rows.set(key, {
      ecosystem: "npm",
      name,
      version: versionText,
      depType,
      tree: "overlays",
      ...sourceFields(declaredIn, "overlays", support),
    });
  }

  await mapPool(plugins, 8, async (plugin) => {
    add(
      plugin.packageName,
      plugin.version,
      "dependencies",
      plugin.declaredIn,
      plugin.support,
    );
    const packument = await getNpmPackument(plugin.packageName);
    const manifest = packument?.versions?.[plugin.version];
    if (!manifest) {
      return;
    }
    for (const [depType, deps] of [
      ["dependencies", manifest.dependencies],
      ["devDependencies", manifest.devDependencies],
      ["peerDependencies", manifest.peerDependencies],
    ]) {
      for (const [depName, depVersion] of Object.entries(deps ?? {})) {
        add(depName, depVersion, depType, plugin.declaredIn, plugin.support);
      }
    }
  });

  return [...rows.values()];
}

function classifyRisk(row) {
  if (row.depType === "devDependencies" || TEST_NAME.test(row.name)) {
    return TEST_NAME.test(row.name) ? "test-only" : "build";
  }
  return "runtime-prod";
}

/** How the dep is used in RHDH. Lower is more important. */
function usageRank(row) {
  if (
    row.depType === "devDependencies" ||
    row.risk === "test-only" ||
    row.risk === "build"
  ) {
    return 2;
  }
  if (row.support === "tech-preview") {
    return 1;
  }
  return 0;
}

/** How stale the dep is. Lower is more outdated. */
function outdatedRank(row) {
  const lastPublish = row.lastPublish;
  if (row.deprecated) {
    return 0;
  }
  if (lastPublish && lastPublish < STALE_LONG_BEFORE) {
    return 1;
  }
  if (lastPublish && lastPublish < UNMAINTAINED_BEFORE) {
    return 2;
  }
  return 3;
}

/**
 * Impact is a lookup of usageRank × outdatedRank, not a numeric score.
 * See scripts/eol-inventory/README.md for the grid.
 */
function classifyImpact(row) {
  const usage = usageRank(row);
  const outdated = outdatedRank(row);

  if ((usage === 0 || usage === 1) && (outdated === 0 || outdated === 1)) {
    return "high";
  }
  if ((usage === 0 || usage === 1) && outdated === 2) {
    return "medium";
  }
  return "low";
}

function classifyStatus({ lastPublish, deprecated }) {
  if (deprecated) {
    return "unmaintained";
  }
  if (lastPublish) {
    if (lastPublish < UNMAINTAINED_BEFORE) {
      return "unmaintained";
    }
    return "OK";
  }
  return "unknown";
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": "rhdh-eol-inventory", ...headers },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, headers);
  return text == null ? undefined : JSON.parse(text);
}

async function enrichNpm(row) {
  try {
    const lookupName = npmLookupName(row.name);
    const meta = await getNpmPackument(row.name);
    if (!meta) {
      return { notes: "not found on npm" };
    }
    const latest = meta["dist-tags"]?.latest;
    const lastPublish = meta.time?.[latest] ?? meta.time?.modified;
    const deprecatedMessage =
      meta.deprecated || (latest && meta.versions?.[latest]?.deprecated) || "";
    let notes = "";
    if (deprecatedMessage) {
      notes = `npm deprecated: ${deprecatedMessage}`;
    } else if (lookupName !== row.name) {
      notes = `resolved as ${lookupName}`;
    }
    return {
      lastPublish: lastPublish ? new Date(lastPublish) : undefined,
      deprecated: Boolean(deprecatedMessage),
      notes,
    };
  } catch (error) {
    return { notes: `npm lookup failed: ${error.message}` };
  }
}

async function enrich(row) {
  let lastPublish;
  let deprecated = false;
  let notes = row.notes ?? "";

  if (row.ecosystem === "npm") {
    const extra = await enrichNpm(row);
    lastPublish = extra.lastPublish;
    deprecated = Boolean(extra.deprecated);
    notes = [notes, extra.notes].filter(Boolean).join("; ");
  }

  const status = classifyStatus({ lastPublish, deprecated });
  const risk = classifyRisk(row);
  const classified = {
    ...row,
    status,
    lastPublish,
    deprecated,
    risk,
    notes,
  };
  const impact = classifyImpact(classified);
  return {
    ...classified,
    impact,
    impact_order: IMPACT_ORDER[impact] ?? 9,
    outdated_order: outdatedRank(classified),
  };
}

function toCsvRow(row) {
  const values = {
    status: row.status,
    status_order: STATUS_ORDER[row.status] ?? 9,
    impact: row.impact ?? "",
    impact_order: row.impact_order ?? 9,
    workspace: row.workspace ?? "",
    plugin: row.plugin ?? "",
    support: row.support ?? "",
    name: row.name,
    version: row.version,
    ecosystem: row.ecosystem,
    dep_type: row.depType,
    tree: row.tree,
    risk: row.risk,
    last_publish: isoDate(row.lastPublish),
    deprecated: row.deprecated ? "TRUE" : "FALSE",
    declared_in: row.declaredIn ?? "",
    notes: row.notes ?? "",
  };
  return CSV_COLUMNS.map((column) => csvEscape(values[column])).join(",");
}

function statusCounts(rows) {
  return rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
}

function countLine(counts) {
  return ["unmaintained", "OK", "unknown"]
    .map((status) => `${status}: ${counts[status] ?? 0}`)
    .join(" · ");
}

function isOverlayRow(row) {
  return row.tree === "overlays";
}

function inMarkdownReport(row) {
  return !(isOverlayRow(row) && row.depType === "devDependencies");
}

function overlayWorkspaces(rows) {
  return [...new Set(rows.map((row) => row.workspace).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function rowsForWorkspace(rows, workspace) {
  return rows.filter((row) => row.workspace === workspace);
}

function sortInventoryRows(a, b) {
  return (
    (a.impact_order ?? 9) - (b.impact_order ?? 9) ||
    (a.outdated_order ?? 9) - (b.outdated_order ?? 9) ||
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    (a.workspace ?? "").localeCompare(b.workspace ?? "") ||
    (a.plugin ?? "").localeCompare(b.plugin ?? "") ||
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version) ||
    a.depType.localeCompare(b.depType)
  );
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", String.raw`\|`)
    .replaceAll("\n", " ");
}

function markdownTable(rows, { includePlugin = false } = {}) {
  const nonGreen = rows.filter((row) => row.status !== "OK").sort(sortInventoryRows);
  if (nonGreen.length === 0) {
    return ["_All OK._", ""];
  }
  const headers = includePlugin
    ? [
        "Impact",
        "Status",
        "Plugin",
        "Name",
        "Version",
        "Risk",
        "Last publish",
      ]
    : [
        "Impact",
        "Status",
        "Name",
        "Version",
        "Risk",
        "Last publish",
      ];
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of nonGreen) {
    const cells = includePlugin
      ? [
          row.impact,
          row.status,
          `\`${row.plugin}\``,
          `\`${row.name}\``,
          markdownCell(row.version),
          row.risk,
          isoDate(row.lastPublish) || "—",
        ]
      : [
          row.impact,
          row.status,
          `\`${row.name}\``,
          markdownCell(row.version),
          row.risk,
          isoDate(row.lastPublish) || "—",
        ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines;
}

function headingId(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function toMarkdown(rows) {
  const coreRows = rows.filter((row) => !isOverlayRow(row));
  const overlayRows = rows.filter(
    (row) => isOverlayRow(row) && inMarkdownReport(row),
  );
  const workspaces = overlayWorkspaces(overlayRows);
  const coreNonOk = coreRows.filter((row) => row.status !== "OK").length;

  const lines = [
    "# EOL dependency inventory (generated)",
    "",
    "Generated by `yarn eol-inventory`. Do not edit by hand.",
    "How to run: [README.md](./README.md).",
    "",
    `- **Unmaintained:** no release in ${UNMAINTAINED_MONTHS} months, or npm deprecated`,
    "- **Impact:** high / medium / low — lookup of usage vs outdatedness, not a CVE score. See [README.md](./README.md).",
    `- **Totals (CSV):** ${countLine(statusCounts(rows))}`,
    "- Plugin workspace tables omit overlay `devDependencies` (those rows stay in the CSV).",
    "- Workspace non-OK counts are not additive; the same package can appear in more than one workspace.",
    "",
    "## Contents",
    "",
    `- [RHDH core](#rhdh-core) — ${coreNonOk} non-OK`,
  ];

  const tocWorkspaces =
    workspaces.length > 0
      ? [
          "- Plugin workspaces",
          ...workspaces.map((workspace) => {
            const grouped = rowsForWorkspace(overlayRows, workspace);
            const nonOk = grouped.filter((row) => row.status !== "OK").length;
            return `  - [${workspace}](#${headingId(workspace)}) — ${nonOk} non-OK`;
          }),
        ]
      : [];

  const workspaceSections =
    workspaces.length > 0
      ? [
          "## Plugin workspaces",
          "",
          ...workspaces.flatMap((workspace) => {
            const grouped = rowsForWorkspace(overlayRows, workspace);
            const support = [
              ...new Set(grouped.map((row) => row.support).filter(Boolean)),
            ].sort((a, b) => a.localeCompare(b));
            return [
              `### ${workspace}`,
              "",
              ...(support.length > 0 ? [`Support: ${support.join(", ")}`] : []),
              countLine(statusCounts(grouped)),
              "",
              ...markdownTable(grouped, { includePlugin: true }),
            ];
          }),
        ]
      : [];

  lines.push(
    ...tocWorkspaces,
    "",
    "## RHDH core",
    "",
    countLine(statusCounts(coreRows)),
    "",
    ...markdownTable(coreRows, { includePlugin: true }),
    ...workspaceSections,
  );

  return `${lines.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n")}\n`;
}

async function main() {
  const overlayRows = await collectOverlayDeclarations();
  const declarations = [
    ...collectNpmDeclarations(),
    ...overlayRows,
  ];

  console.log(`Collected ${declarations.length} direct declarations`);

  const enriched = await mapPool(declarations, 8, (row) => enrich(row));

  enriched.sort(sortInventoryRows);

  const csv = [CSV_COLUMNS.join(","), ...enriched.map(toCsvRow)].join("\n");
  writeFileSync(OUTPUT_CSV, `${csv}\n`);
  writeFileSync(OUTPUT_MD, toMarkdown(enriched));

  console.log(`Wrote ${OUTPUT_CSV}`);
  console.log(`Wrote ${OUTPUT_MD}`);
}

await main();
