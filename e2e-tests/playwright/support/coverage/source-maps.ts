// Jira: RHIDP-13242 — Attach the deployed app's source maps before monocart sees them
//
// Two reasons not to leave this to monocart's own resolver:
// - It fetches `*.js.map` with Node's certificate checks and logs a failure only at
//   debug level. CI clusters serve RHDH behind router certificates the test process
//   does not trust, so every map would silently fail to load. The specs reach the
//   same routes through Playwright with `ignoreHTTPSErrors` (playwright.config.ts);
//   the maps are fetched the same way.
// - A bundle whose map did not load skips `sourceFilter` entirely and lands in the
//   report under its minified URL, which Codecov cannot match to the repository.
// Resolving here lets an entry without a map be dropped instead.

import { request } from "@playwright/test";

import { isAppBundle } from "./source-paths";

// Per map. Generous for a static file; bounds a stalled route instead of hanging onEnd.
const SOURCE_MAP_TIMEOUT_MS = 30_000;
const SOURCE_MAPPING_URL = /\/\/[#@] sourceMappingURL=(\S+)\s*$/u;

/** The fields of a V8 script coverage entry this module reads or sets. */
export type CoverageEntry = {
  url: string;
  source?: string;
  sourceMap?: unknown;
};

export function isCoverageEntry(value: unknown): value is CoverageEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string"
  );
}

/**
 * Fetch a JSON document the way the specs reach the app: through Playwright, with the
 * `ignoreHTTPSErrors` setting playwright.config.ts uses for the cluster routes.
 */
export async function fetchJson(
  url: string,
  timeoutMs = SOURCE_MAP_TIMEOUT_MS,
): Promise<unknown> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const response = await context.get(url, { timeout: timeoutMs });
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} for ${url}`);
    }
    return JSON.parse(await response.text());
  } finally {
    await context.dispose();
  }
}

function sourceMapReferenceOf(entry: CoverageEntry): string | undefined {
  return SOURCE_MAPPING_URL.exec(entry.source ?? "")?.[1];
}

/** Whether the entry carries its map inline, which monocart decodes on its own. */
function hasInlineSourceMap(entry: CoverageEntry): boolean {
  return sourceMapReferenceOf(entry)?.startsWith("data:") ?? false;
}

/** The absolute URL of the entry's external source map, if its source names one. */
export function sourceMapUrlOf(entry: CoverageEntry): string | undefined {
  const reference = sourceMapReferenceOf(entry);
  if (reference === undefined || reference.startsWith("data:")) {
    return undefined;
  }
  try {
    return new URL(reference, entry.url).toString();
  } catch {
    return undefined;
  }
}

/**
 * Keeps the app's bundles and attaches each one's source map, fetched once per URL
 * across every raw coverage file. Entries with an inline map pass through as they
 * are; entries whose external map cannot be loaded are dropped.
 */
export class SourceMapLoader {
  private readonly maps = new Map<string, Promise<unknown>>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly fetchMap: (url: string) => Promise<unknown> = fetchJson,
  ) {}

  /** Map URLs that could not be loaded so far. */
  get failures(): readonly string[] {
    return [...this.failed];
  }

  async attach(entries: unknown[]): Promise<CoverageEntry[]> {
    const appEntries = entries.filter(
      (entry): entry is CoverageEntry =>
        isCoverageEntry(entry) && isAppBundle(entry),
    );
    const mapped: CoverageEntry[] = [];
    for (const entry of appEntries) {
      if (hasInlineSourceMap(entry)) {
        mapped.push(entry);
        continue;
      }
      const url = sourceMapUrlOf(entry);
      const sourceMap = url === undefined ? null : await this.load(url);
      if (sourceMap !== null) {
        mapped.push({ ...entry, sourceMap });
      }
    }
    return mapped;
  }

  private load(url: string): Promise<unknown> {
    let map = this.maps.get(url);
    if (map === undefined) {
      map = this.fetchMap(url).catch((error: unknown) => {
        this.failed.add(url);
        console.warn(`[coverage] Could not load source map ${url}:`, error);
        return null;
      });
      this.maps.set(url, map);
    }
    return map;
  }
}
