import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createNpmFetcher } from "./registry.ts";

describe("createNpmFetcher", () => {
  describe("fetchVersion", () => {
    it("fetches metadata for a specific version", async () => {
      const fetcher = createNpmFetcher();
      const meta = await fetcher.fetchVersion("is-odd", "1.0.0");
      assert.equal(meta.version, "1.0.0");
      assert.ok(meta.dependencies, "should have dependencies");
      assert.ok("is-number" in meta.dependencies!, "should depend on is-number");
    });

    it("throws for a non-existent version", async () => {
      const fetcher = createNpmFetcher();
      await assert.rejects(
        () => fetcher.fetchVersion("is-odd", "999.999.999"),
      );
    });
  });

  describe("fetchAllVersions", () => {
    it("fetches all versions of a package", async () => {
      const fetcher = createNpmFetcher();
      const versions = await fetcher.fetchAllVersions("is-odd");
      assert.ok("1.0.0" in versions, "should include 1.0.0");
      assert.ok("3.0.1" in versions, "should include 3.0.1");
      assert.equal(versions["1.0.0"].version, "1.0.0");
    });

    it("caches results across calls", async () => {
      const fetcher = createNpmFetcher();
      const first = await fetcher.fetchAllVersions("is-odd");
      const second = await fetcher.fetchAllVersions("is-odd");
      assert.equal(first, second, "should return the same object reference");
    });

    it("does not share cache between fetcher instances", async () => {
      const a = createNpmFetcher();
      const b = createNpmFetcher();
      const fromA = await a.fetchAllVersions("is-odd");
      const fromB = await b.fetchAllVersions("is-odd");
      assert.notEqual(fromA, fromB, "different instances should have independent caches");
    });
  });
});
