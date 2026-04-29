import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringifySyml, parseSyml } from "@yarnpkg/parsers";
import { structUtils } from "@yarnpkg/core";
import type { AbbreviatedVersion } from "package-json";
import {
  splitDescriptorKey,
  descriptorPackageName,
  extractSpecs,
  buildDescriptorKey,
  buildLockEntry,
  bumpLockfile,
  type RegistryFetcher,
} from "./lib.ts";

function fakeVersion(overrides: Pick<AbbreviatedVersion, "version"> & Partial<AbbreviatedVersion>): AbbreviatedVersion {
  return {
    name: overrides.name ?? "test",
    dist: { tarball: "", shasum: "", ...(overrides.dist ?? {}) },
    ...overrides,
  };
}

describe("splitDescriptorKey", () => {
  it("splits a compound key on commas", () => {
    assert.deepEqual(
      splitDescriptorKey("@foo/bar@npm:^1.0.0, @foo/bar@npm:1.2.3"),
      ["@foo/bar@npm:^1.0.0", "@foo/bar@npm:1.2.3"],
    );
  });

  it("handles no spaces around commas", () => {
    assert.deepEqual(
      splitDescriptorKey("@foo/bar@npm:^1.0.0,@foo/bar@npm:1.2.3"),
      ["@foo/bar@npm:^1.0.0", "@foo/bar@npm:1.2.3"],
    );
  });

  it("handles extra spaces around commas", () => {
    assert.deepEqual(
      splitDescriptorKey("@foo/bar@npm:^1.0.0 , @foo/bar@npm:1.2.3"),
      ["@foo/bar@npm:^1.0.0", "@foo/bar@npm:1.2.3"],
    );
  });
});

describe("descriptorPackageName", () => {
  it("extracts name from first descriptor in a compound key", () => {
    assert.equal(
      descriptorPackageName("@foo/bar@npm:^1.0.0, @foo/bar@npm:1.2.3"),
      "@foo/bar",
    );
  });

  it("returns null for empty string", () => {
    assert.equal(descriptorPackageName(""), null);
  });
});

describe("extractSpecs", () => {
  it("extracts specs from a compound key", () => {
    assert.deepEqual(
      extractSpecs("@foo/bar@npm:^1.0.0, @foo/bar@npm:1.2.3"),
      ["^1.0.0", "1.2.3"],
    );
  });

  it("returns only npm specs when mixed with patch descriptors", () => {
    const key =
      "@foo/bar@npm:^1.0.0, @foo/bar@patch:@foo/bar@npm%3A1.0.0#./patches/foo.patch";
    assert.deepEqual(extractSpecs(key), ["^1.0.0"]);
  });
});

describe("buildDescriptorKey", () => {
  it("builds a key for a single spec", () => {
    assert.equal(
      buildDescriptorKey("@foo/bar", ["1.0.0"]),
      "@foo/bar@npm:1.0.0",
    );
  });

  it("builds a sorted compound key for multiple specs", () => {
    const key = buildDescriptorKey("@foo/bar", ["^1.0.0", "1.2.3"]);
    assert.equal(key, "@foo/bar@npm:1.2.3, @foo/bar@npm:^1.0.0");
  });

  it("round-trips through extractSpecs", () => {
    const specs = ["^1.0.0", "1.2.3"];
    const key = buildDescriptorKey("@foo/bar", specs);
    const extracted = extractSpecs(key);
    assert.deepEqual(extracted.sort(), specs.sort());
  });
});

describe("buildLockEntry", () => {
  it("produces a complete lockfile entry", () => {
    const deps = { baz: "^2.0.0" };
    const peerDeps = { react: "^18.0.0" };
    const peerDepsMeta = { react: { optional: true as const } };
    const meta = fakeVersion({
      version: "1.2.3",
      dependencies: deps,
      peerDependencies: peerDeps,
      peerDependenciesMeta: peerDepsMeta,
    });
    assert.deepEqual(buildLockEntry("@foo/bar", "1.2.3", meta), {
      version: "1.2.3",
      resolution: "@foo/bar@npm:1.2.3",
      languageName: "node",
      linkType: "hard",
      checksum: undefined,
      dependencies: deps,
      peerDependencies: peerDeps,
      peerDependenciesMeta: peerDepsMeta,
      dist: meta.dist,
    });
  });
});

describe("bumpLockfile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lockfile-bump-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeFetcher(
    versionData: Record<string, AbbreviatedVersion>,
    allVersionsData: Record<string, Record<string, AbbreviatedVersion>>,
  ): RegistryFetcher {
    return {
      async fetchVersion(name, version) {
        const key = `${name}@${version}`;
        if (key in versionData) return versionData[key];
        throw new Error(`Unexpected fetchVersion: ${key}`);
      },
      async fetchAllVersions(name) {
        if (name in allVersionsData) return allVersionsData[name];
        throw new Error(`Unexpected fetchAllVersions: ${name}`);
      },
    };
  }

  it("replaces a target package and resolves transitive deps to minimum versions", async () => {
    const fetcher = makeFetcher(
      {
        "@scope/target@1.1.0": fakeVersion({
          name: "@scope/target",
          version: "1.1.0",
          dependencies: { "@scope/transitive": "^2.1.0" },
        }),
      },
      {
        "@scope/transitive": {
          "2.0.0": fakeVersion({ name: "@scope/transitive", version: "2.0.0" }),
          "2.1.0": fakeVersion({ name: "@scope/transitive", version: "2.1.0" }),
          "2.2.0": fakeVersion({ name: "@scope/transitive", version: "2.2.0" }),
          "2.3.0": fakeVersion({ name: "@scope/transitive", version: "2.3.0" }),
        },
      },
    );

    const lockfileContent = stringifySyml({
      __metadata: { version: 6, cacheKey: "8" },
      "@scope/target@npm:^1.0.0, @scope/target@npm:1.0.0": {
        version: "1.0.0",
        resolution: "@scope/target@npm:1.0.0",
        dependencies: { "@scope/transitive": "^2.0.0" },
        checksum: "abc123",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/transitive@npm:^2.0.0": {
        version: "2.0.0",
        resolution: "@scope/transitive@npm:2.0.0",
        checksum: "def456",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/unrelated@npm:^3.0.0": {
        version: "3.0.0",
        resolution: "@scope/unrelated@npm:3.0.0",
        checksum: "ghi789",
        languageName: "node",
        linkType: "hard",
      },
    });

    const lockfilePath = join(tmpDir, "yarn.lock");
    writeFileSync(lockfilePath, lockfileContent);

    await bumpLockfile(
      lockfilePath,
      [structUtils.parseDescriptor("@scope/target@1.1.0")],
      fetcher,
    );

    const result = parseSyml(readFileSync(lockfilePath, "utf-8"));

    // Old target entry removed, new one present
    assert.equal(
      "@scope/target@npm:^1.0.0, @scope/target@npm:1.0.0" in result,
      false,
      "old target key should be removed",
    );
    const newTargetKey = Object.keys(result).find(
      (k) => k.includes("@scope/target@npm:1.1.0"),
    );
    assert.ok(newTargetKey, "new target entry should exist");
    assert.equal(result[newTargetKey!].version, "1.1.0");

    // ^1.0.0 should be carried over (1.1.0 satisfies it)
    assert.ok(
      newTargetKey!.includes("@scope/target@npm:^1.0.0"),
      "^1.0.0 range alias should be preserved",
    );

    // Transitive: ^2.1.0 should resolve to 2.1.0 (minimum), not 2.3.0
    const transitiveKey = Object.keys(result).find(
      (k) => k.includes("@scope/transitive@npm:^2.1.0"),
    );
    assert.ok(transitiveKey, "new transitive entry should exist for ^2.1.0");
    assert.equal(
      result[transitiveKey!].version,
      "2.1.0",
      "transitive should resolve to minimum satisfying version",
    );

    // Old transitive entry for ^2.0.0 -> 2.0.0 should still be there
    assert.ok(
      "@scope/transitive@npm:^2.0.0" in result,
      "existing transitive entry should be preserved",
    );
    assert.equal(result["@scope/transitive@npm:^2.0.0"].version, "2.0.0");

    // __metadata preserved
    assert.ok("__metadata" in result, "__metadata should be preserved");
    assert.equal(result["__metadata"].version, "6");

    // Unrelated package untouched
    assert.ok(
      "@scope/unrelated@npm:^3.0.0" in result,
      "unrelated package should be untouched",
    );
    assert.equal(result["@scope/unrelated@npm:^3.0.0"].checksum, "ghi789");
  });

  it("skips transitive deps already satisfied by existing lockfile entries", async () => {
    const fetcher = makeFetcher(
      {
        "@scope/pkg@2.0.0": fakeVersion({
          name: "@scope/pkg",
          version: "2.0.0",
          dependencies: { "@scope/dep": "^1.0.0" },
        }),
      },
      {},
    );

    const lockfileContent = stringifySyml({
      __metadata: { version: 6, cacheKey: "8" },
      "@scope/pkg@npm:1.0.0": {
        version: "1.0.0",
        resolution: "@scope/pkg@npm:1.0.0",
        checksum: "old",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/dep@npm:^1.0.0": {
        version: "1.5.0",
        resolution: "@scope/dep@npm:1.5.0",
        checksum: "existing",
        languageName: "node",
        linkType: "hard",
      },
    });

    const lockfilePath = join(tmpDir, "yarn.lock");
    writeFileSync(lockfilePath, lockfileContent);

    await bumpLockfile(
      lockfilePath,
      [structUtils.parseDescriptor("@scope/pkg@2.0.0")],
      fetcher,
    );

    const result = parseSyml(readFileSync(lockfilePath, "utf-8"));

    // fetchAllVersions should NOT have been called (dep already satisfied)
    // and the existing dep entry should be untouched
    assert.equal(result["@scope/dep@npm:^1.0.0"].version, "1.5.0");
    assert.equal(result["@scope/dep@npm:^1.0.0"].checksum, "existing");
  });

  it("removes patch entries alongside npm entries", async () => {
    const fetcher = makeFetcher(
      {
        "@scope/patched@1.1.0": fakeVersion({
          name: "@scope/patched",
          version: "1.1.0",
        }),
      },
      {},
    );

    const lockfileContent = stringifySyml({
      __metadata: { version: 6, cacheKey: "8" },
      "@scope/patched@npm:1.0.0": {
        version: "1.0.0",
        resolution: "@scope/patched@npm:1.0.0",
        checksum: "npm-checksum",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/patched@patch:@scope/patched@npm%3A1.0.0#./patches/fix.patch": {
        version: "1.0.0",
        resolution: "@scope/patched@patch:@scope/patched@npm%3A1.0.0#./patches/fix.patch::version=1.0.0&hash=abc",
        checksum: "patch-checksum",
        languageName: "node",
        linkType: "hard",
      },
    });

    const lockfilePath = join(tmpDir, "yarn.lock");
    writeFileSync(lockfilePath, lockfileContent);

    await bumpLockfile(
      lockfilePath,
      [structUtils.parseDescriptor("@scope/patched@1.1.0")],
      fetcher,
    );

    const result = parseSyml(readFileSync(lockfilePath, "utf-8"));

    // Both old entries should be gone
    const keys = Object.keys(result).filter((k) => k.includes("@scope/patched"));
    assert.equal(keys.length, 1, "should have exactly one entry for the package");
    assert.ok(keys[0].includes("1.1.0"), "entry should be for 1.1.0");

    // No patch entries remain
    assert.ok(
      !keys.some((k) => k.includes("patch:")),
      "no patch entries should remain",
    );
  });

  it("includes range aliases from all new entries that a transitive satisfies", async () => {
    // Two targets both depend on the same transitive with different ranges.
    // The new transitive entry should alias both ranges in its descriptor key.
    const fetcher = makeFetcher(
      {
        "@scope/a@2.0.0": fakeVersion({
          name: "@scope/a",
          version: "2.0.0",
          dependencies: { "@scope/shared": "^1.2.0" },
        }),
        "@scope/b@3.0.0": fakeVersion({
          name: "@scope/b",
          version: "3.0.0",
          dependencies: { "@scope/shared": "^1.3.0" },
        }),
      },
      {
        "@scope/shared": {
          "1.2.0": fakeVersion({ name: "@scope/shared", version: "1.2.0" }),
          "1.3.0": fakeVersion({ name: "@scope/shared", version: "1.3.0" }),
          "1.4.0": fakeVersion({ name: "@scope/shared", version: "1.4.0" }),
        },
      },
    );

    const lockfileContent = stringifySyml({
      __metadata: { version: 6, cacheKey: "8" },
      "@scope/a@npm:1.0.0": {
        version: "1.0.0",
        resolution: "@scope/a@npm:1.0.0",
        checksum: "a-old",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/b@npm:2.0.0": {
        version: "2.0.0",
        resolution: "@scope/b@npm:2.0.0",
        checksum: "b-old",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/shared@npm:^1.0.0": {
        version: "1.1.0",
        resolution: "@scope/shared@npm:1.1.0",
        checksum: "shared-old",
        languageName: "node",
        linkType: "hard",
      },
    });

    const lockfilePath = join(tmpDir, "yarn.lock");
    writeFileSync(lockfilePath, lockfileContent);

    await bumpLockfile(
      lockfilePath,
      [
        structUtils.parseDescriptor("@scope/a@2.0.0"),
        structUtils.parseDescriptor("@scope/b@3.0.0"),
      ],
      fetcher,
    );

    const result = parseSyml(readFileSync(lockfilePath, "utf-8"));

    // The shared dep should resolve to 1.3.0 (minimum satisfying ^1.3.0)
    const sharedKey = Object.keys(result).find(
      (k) => k.includes("@scope/shared") && k.includes("1.3.0"),
    );
    assert.ok(sharedKey, "new shared entry should exist");
    assert.equal(result[sharedKey!].version, "1.3.0");

    // The key should alias BOTH ^1.2.0 and ^1.3.0 (since 1.3.0 satisfies both)
    assert.ok(
      sharedKey!.includes("@scope/shared@npm:^1.2.0"),
      "should alias ^1.2.0",
    );
    assert.ok(
      sharedKey!.includes("@scope/shared@npm:^1.3.0"),
      "should alias ^1.3.0",
    );

    // Old ^1.0.0 entry should still exist (1.1.0 satisfies it, untouched)
    assert.ok(
      "@scope/shared@npm:^1.0.0" in result,
      "existing shared entry should be preserved",
    );
  });

  it("aliases ranges from existing lockfile entries' dependency lists", async () => {
    const fetcher = makeFetcher(
      {
        "@scope/pkg@1.2.0": fakeVersion({
          name: "@scope/pkg",
          version: "1.2.0",
        }),
      },
      {},
    );

    const lockfileContent = stringifySyml({
      __metadata: { version: 6, cacheKey: "8" },
      "@scope/pkg@npm:1.0.0": {
        version: "1.0.0",
        resolution: "@scope/pkg@npm:1.0.0",
        checksum: "old",
        languageName: "node",
        linkType: "hard",
      },
      "@scope/other@npm:^1.0.0": {
        version: "1.0.0",
        resolution: "@scope/other@npm:1.0.0",
        dependencies: { "@scope/pkg": "^1.0.0" },
        checksum: "other",
        languageName: "node",
        linkType: "hard",
      },
    });

    const lockfilePath = join(tmpDir, "yarn.lock");
    writeFileSync(lockfilePath, lockfileContent);

    await bumpLockfile(
      lockfilePath,
      [structUtils.parseDescriptor("@scope/pkg@1.2.0")],
      fetcher,
    );

    const result = parseSyml(readFileSync(lockfilePath, "utf-8"));

    // The new entry should alias ^1.0.0 from @scope/other's dependency list
    const pkgKey = Object.keys(result).find(
      (k) => k.includes("@scope/pkg") && k.includes("1.2.0"),
    );
    assert.ok(pkgKey, "new pkg entry should exist");
    assert.ok(
      pkgKey!.includes("@scope/pkg@npm:^1.0.0"),
      "should alias ^1.0.0 from existing entry's dependencies",
    );
  });

  it("resolves multi-level transitive dependencies", async () => {
    const fetcher = makeFetcher(
      {
        "@scope/root@2.0.0": fakeVersion({
          name: "@scope/root",
          version: "2.0.0",
          dependencies: { "@scope/mid": "^1.1.0" },
        }),
      },
      {
        "@scope/mid": {
          "1.0.0": fakeVersion({ name: "@scope/mid", version: "1.0.0" }),
          "1.1.0": fakeVersion({
            name: "@scope/mid",
            version: "1.1.0",
            dependencies: { "@scope/leaf": "^3.2.0" },
          }),
        },
        "@scope/leaf": {
          "3.1.0": fakeVersion({ name: "@scope/leaf", version: "3.1.0" }),
          "3.2.0": fakeVersion({ name: "@scope/leaf", version: "3.2.0" }),
          "3.3.0": fakeVersion({ name: "@scope/leaf", version: "3.3.0" }),
        },
      },
    );

    const lockfileContent = stringifySyml({
      __metadata: { version: 6, cacheKey: "8" },
      "@scope/root@npm:1.0.0": {
        version: "1.0.0",
        resolution: "@scope/root@npm:1.0.0",
        checksum: "old",
        languageName: "node",
        linkType: "hard",
      },
    });

    const lockfilePath = join(tmpDir, "yarn.lock");
    writeFileSync(lockfilePath, lockfileContent);

    await bumpLockfile(
      lockfilePath,
      [structUtils.parseDescriptor("@scope/root@2.0.0")],
      fetcher,
    );

    const result = parseSyml(readFileSync(lockfilePath, "utf-8"));

    // Mid-level: ^1.1.0 -> 1.1.0 (minimum)
    const midKey = Object.keys(result).find(
      (k) => k.includes("@scope/mid"),
    );
    assert.ok(midKey, "mid-level transitive should be added");
    assert.equal(result[midKey!].version, "1.1.0");

    // Leaf-level: ^3.2.0 -> 3.2.0 (minimum, not 3.3.0)
    const leafKey = Object.keys(result).find(
      (k) => k.includes("@scope/leaf"),
    );
    assert.ok(leafKey, "leaf-level transitive should be added");
    assert.equal(result[leafKey!].version, "3.2.0");
  });
});
