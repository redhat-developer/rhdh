import { readFileSync, writeFileSync } from "node:fs";
import { minSatisfying, satisfies } from "semver";
import { parseSyml, stringifySyml } from "@yarnpkg/parsers";
import { structUtils, Manifest } from "@yarnpkg/core";
import type { Descriptor } from "@yarnpkg/core";
import type { AbbreviatedVersion } from "package-json";

// ---------------------------------------------------------------------------
// Lockfile descriptor helpers
// ---------------------------------------------------------------------------

/**
 * Splits a compound lockfile descriptor key into individual descriptor strings.
 * Uses the same regex as Yarn's `Project.ts`.
 */
export function splitDescriptorKey(key: string): string[] {
  return key.split(/ *, */);
}

/**
 * Extracts the full package name (e.g. `@backstage/backend-defaults`) from a
 * lockfile descriptor key. Handles `npm:`, `patch:`, and compound keys.
 */
export function descriptorPackageName(key: string): string | null {
  const first = splitDescriptorKey(key)[0];
  const descriptor = structUtils.tryParseDescriptor(first);
  if (!descriptor) return null;
  return structUtils.stringifyIdent(descriptor);
}

/**
 * Extracts all semver selectors from the `npm:` descriptors in a compound
 * descriptor key. Non-npm descriptors (e.g. `patch:`) are skipped.
 *
 * e.g. `"@foo/bar@npm:^1.0.0, @foo/bar@npm:1.2.3"` -> `["^1.0.0", "1.2.3"]`
 */
export function extractSpecs(key: string): string[] {
  return splitDescriptorKey(key)
    .map((part) => {
      const descriptor = structUtils.tryParseDescriptor(part);
      if (!descriptor) return null;
      const range = structUtils.parseRange(descriptor.range);
      return range.protocol === "npm:" ? range.selector : null;
    })
    .filter((s) => s !== null);
}

/**
 * Builds a compound lockfile descriptor key from a package name and a list of
 * semver specs. Mirrors the serialization logic in Yarn's `Project.ts`.
 */
export function buildDescriptorKey(name: string, specs: string[]): string {
  const ident = structUtils.parseIdent(name);
  return specs
    .map((s) => structUtils.stringifyDescriptor(structUtils.makeDescriptor(ident, `npm:${s}`)))
    .sort()
    .join(`, `);
}

/**
 * Builds a lockfile entry object for a given package version, mirroring
 * the serialization in Yarn's `Project.generateLockfile()`. The checksum
 * is left undefined — `yarn install` will fetch the tarball and fill it in.
 */
export function buildLockEntry(
  name: string,
  version: string,
  meta: AbbreviatedVersion,
): Record<string, unknown> {
  const ident = structUtils.parseIdent(name);
  const locator = structUtils.makeLocator(ident, `npm:${version}`);

  const manifest = new Manifest();
  manifest.load(meta as any);
  manifest.name = null;
  manifest.languageName = "node";

  return {
    ...manifest.exportTo({}, { compatibilityMode: false }),
    linkType: "hard",
    resolution: structUtils.stringifyLocator(locator),
    checksum: undefined,
  };
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Ponyfill for `Map.prototype.getOrInsertComputed` (ES2027). */
function getOrInsertComputed<K, V>(map: Map<K, V>, key: K, compute: (key: K) => V): V {
  if (map.has(key)) return map.get(key)!;
  const value = compute(key);
  map.set(key, value);
  return value;
}

interface LockfileEntry {
  name: string;
  version: string;
  meta: AbbreviatedVersion;
  specs: string[];
}

export interface RegistryFetcher {
  fetchVersion: (name: string, version: string) => Promise<AbbreviatedVersion>;
  fetchAllVersions: (name: string) => Promise<Record<string, AbbreviatedVersion>>;
}

/**
 * Core entry point. Parses the lockfile, replaces target package entries with
 * new versions, resolves unsatisfied transitive dependency ranges to their
 * minimum satisfying versions, and writes the updated lockfile.
 */
export async function bumpLockfile(
  lockfilePath: string,
  targets: Descriptor[],
  registry: RegistryFetcher,
): Promise<void> {
  const lock = parseSyml(
    readFileSync(lockfilePath, "utf-8"),
  );

  const keysByPkg = new Map<string, string[]>();
  const resolvedVersions = new Map<string, Set<string>>();

  for (const [key, entry] of Object.entries(lock)) {
    if (key === "__metadata") continue;
    const name = descriptorPackageName(key);
    if (!name) continue;

    getOrInsertComputed(keysByPkg, name, () => []).push(key);

    if (entry?.version) {
      getOrInsertComputed(resolvedVersions, name, () => new Set()).add(entry.version);
    }
  }

  // Phase 1: Replace target packages
  const newEntries: LockfileEntry[] = [];

  for (const target of targets) {
    const name = structUtils.stringifyIdent(target);

    console.log(`\n📦 ${name}@${target.range}`);
    const meta = await registry.fetchVersion(name, target.range);
    const existingKeys = keysByPkg.get(name) ?? [];

    const specs = new Set([target.range]);
    for (const key of existingKeys) {
      for (const spec of extractSpecs(key)) {
        if (satisfies(target.range, spec) || spec === target.range)
          specs.add(spec);
      }
    }

    for (const key of existingKeys) {
      console.log(
        `  Remove: ${key.slice(0, 80)}${key.length > 80 ? "..." : ""}`,
      );
      delete lock[key];
    }

    newEntries.push({
      name,
      version: target.range,
      meta,
      specs: [...specs].sort(),
    });
    console.log(`  Specs: ${[...specs].join(", ")}`);
    resolvedVersions.set(name, new Set([target.range]));
  }

  // Phase 2: Walk transitive deps, adding minimum-version entries as needed
  console.log("\n🔍 Analyzing transitive dependencies...");
  const queue = [...newEntries];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    const key = `${item.name}@${item.version}`;
    // Avoid processing the same package@version twice
    if (visited.has(key)) continue;
    visited.add(key);

    // Nothing to resolve if this entry has no dependencies
    if (!item.meta.dependencies) continue;

    for (const [depName, depRange] of Object.entries(item.meta.dependencies)) {
      const existing = resolvedVersions.get(depName) ?? new Set();
      // Skip if any version already in the lockfile satisfies this range
      if ([...existing].some((v) => satisfies(v, depRange))) continue;
      // Skip if a version we're already adding satisfies this range
      if (newEntries.some((e) => e.name === depName && satisfies(e.version, depRange)))
        continue;

      const allVersions = await registry.fetchAllVersions(depName);
      const minVer = minSatisfying(Object.keys(allVersions), depRange);
      if (!minVer) {
        console.warn(`  ⚠️  No version of ${depName} satisfies ${depRange}`);
        continue;
      }

      console.log(`  ${depName}: ${depRange} → ${minVer}`);
      const entry = {
        name: depName,
        version: minVer,
        meta: allVersions[minVer],
        specs: [depRange],
      };
      newEntries.push(entry);
      queue.push(entry);

      getOrInsertComputed(resolvedVersions, depName, () => new Set()).add(minVer);
    }
  }

  // Phase 3: Collect all range aliases that each new entry should satisfy.
  // This ensures Yarn won't re-resolve ranges that our entries already cover.

  // Build a set of all dependency ranges declared across the lockfile and
  // new entries, so we can alias ranges that our new versions satisfy.
  const allDeclaredRanges = new Map<string, Set<string>>();
  for (const [key, lockEntry] of Object.entries(lock)) {
    if (key === "__metadata") continue;
    const deps = lockEntry?.dependencies;
    if (typeof deps !== "object" || deps === null) continue;
    for (const [depName, depRange] of Object.entries(deps)) {
      if (typeof depRange === "string") {
        getOrInsertComputed(allDeclaredRanges, depName, () => new Set()).add(depRange);
      }
    }
  }
  for (const entry of newEntries) {
    if (!entry.meta.dependencies) continue;
    for (const [depName, depRange] of Object.entries(entry.meta.dependencies)) {
      getOrInsertComputed(allDeclaredRanges, depName, () => new Set()).add(depRange);
    }
  }

  for (const entry of newEntries) {
    const allSpecs = new Set<string>(entry.specs);

    // Check all ranges declared anywhere in the lockfile for this package
    for (const range of allDeclaredRanges.get(entry.name) ?? []) {
      if (satisfies(entry.version, range))
        allSpecs.add(range);
    }

    // Also check ranges from existing descriptor keys
    for (const existingKey of keysByPkg.get(entry.name) ?? []) {
      for (const spec of extractSpecs(existingKey)) {
        if (satisfies(entry.version, spec))
          allSpecs.add(spec);
      }
    }

    entry.specs = [...allSpecs].sort();
  }

  // Phase 4: Write new entries into the lockfile object
  console.log("\n✏️  Writing entries...");
  for (const entry of newEntries) {
    const key = buildDescriptorKey(entry.name, entry.specs);
    lock[key] = buildLockEntry(entry.name, entry.version, entry.meta);
  }

  // Phase 4: Serialize using Yarn's own formatter
  writeFileSync(lockfilePath, stringifySyml(lock));

  console.log("\n--- Summary ---");
  console.log(`Lockfile: ${lockfilePath}`);
  console.log(`Packages bumped: ${targets.length}`);
  console.log(`New transitive entries: ${newEntries.length - targets.length}`);
  console.log(
    "\nRun `yarn install --mode=update-lockfile` to fill in checksums.",
  );
}
