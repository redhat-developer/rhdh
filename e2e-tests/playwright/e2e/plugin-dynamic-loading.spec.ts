/**
 * Plugin Dynamic Loading Sanity Check (RHIDP-13508).
 * See "Plugin Sanity Check" in e2e-tests/README.md; runs only via
 * playwright.plugin-sanity.config.ts.
 */

import { resolve } from "path";

import { test, expect } from "@support/coverage/test";

import {
  loadManifest,
  parseLoadedPluginNames,
  readCatalogIndexExpectation,
  validateFrontendBundles,
} from "../utils/plugin-loader";

// populate-catalog-index.sh installs into <repo root>/dynamic-plugins-root;
// Playwright runs with cwd e2e-tests.
const DYNAMIC_PLUGINS_ROOT = resolve(process.cwd(), "..", "dynamic-plugins-root");

test.describe("Plugin Dynamic Loading", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test(
    "all catalog index plugins load in the RHDH backend",
    { tag: "@sanity" },
    async ({ request }) => {
      const manifest = loadManifest(DYNAMIC_PLUGINS_ROOT);
      console.log(
        `[TEST] Installed: ${manifest.backend.length} backend, ${manifest.frontend.length} frontend plugins`,
      );

      const expected = [...manifest.backend, ...manifest.frontend];

      // The count check below is what catches a partial install; without it
      // this spec only asserts "installed ⊆ loaded" and passes trivially.
      // Throw rather than assert-and-return: a bare `return` here would report
      // the test as PASSED without having validated anything.
      const indexExpectation = readCatalogIndexExpectation(DYNAMIC_PLUGINS_ROOT);
      if (indexExpectation === null) {
        throw new Error(
          "dynamic-plugins-root was not populated from the catalog index - run " +
            "local-harness/populate-catalog-index.sh with CATALOG_INDEX_IMAGE set",
        );
      }

      console.log(`[TEST] Catalog index: ${indexExpectation.image}`);
      if (process.env.CATALOG_INDEX_IMAGE !== undefined && process.env.CATALOG_INDEX_IMAGE !== "") {
        expect(
          indexExpectation.image,
          "dynamic-plugins-root was populated from a different catalog index than " +
            "CATALOG_INDEX_IMAGE - re-run populate-catalog-index.sh",
        ).toBe(process.env.CATALOG_INDEX_IMAGE);
      }
      expect(
        expected.length,
        `installed plugin count should match the ${indexExpectation.expectedOciPackages} ` +
          `oci:// packages declared by ${indexExpectation.image}`,
      ).toBe(indexExpectation.expectedOciPackages);

      // loaded-plugins requires user credentials, so authenticate as guest.
      const refresh = await request.get("/api/auth/guest/refresh", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      expect(refresh.status(), "guest auth refresh should succeed").toBe(200);
      const session: unknown = await refresh.json();
      const token =
        typeof session === "object" &&
        session !== null &&
        "backstageIdentity" in session &&
        typeof session.backstageIdentity === "object" &&
        session.backstageIdentity !== null &&
        "token" in session.backstageIdentity &&
        typeof session.backstageIdentity.token === "string"
          ? session.backstageIdentity.token
          : undefined;
      expect(token, "guest session should carry a backstage identity token").toBeDefined();

      const response = await request.get("/api/dynamic-plugins-info/loaded-plugins", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status(), "loaded-plugins endpoint should respond").toBe(200);
      const loadedNames = parseLoadedPluginNames(await response.json());
      console.log(`[TEST] Backend reports ${loadedNames.size} loaded dynamic plugins`);

      const notLoaded = expected.filter((plugin) => !loadedNames.has(plugin.name));
      if (notLoaded.length > 0) {
        console.log(`\n[TEST] Installed but not loaded (${notLoaded.length}):`);
        for (const plugin of notLoaded) {
          console.log(`   - ${plugin.name} (${plugin.dirName})`);
        }
        console.log("\nLoaded plugins reported by the backend:");
        // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; toSorted needs lib es2023+
        for (const name of [...loadedNames].sort()) {
          console.log(`   - ${name}`);
        }
      }
      expect(
        notLoaded.map((plugin) => plugin.name),
        "every installed plugin should be loaded by the backend",
      ).toEqual([]);

      const frontendErrors = validateFrontendBundles(manifest.frontend);
      if (frontendErrors.length > 0) {
        console.log(`\n[TEST] Frontend bundle errors (${frontendErrors.length}):`);
        for (const { plugin, error } of frontendErrors) {
          console.log(`   - ${plugin.name}: ${error}`);
        }
      }
      expect(
        frontendErrors.map(({ plugin, error }) => `${plugin.name}: ${error}`),
        "every frontend plugin should ship valid bundle artifacts",
      ).toEqual([]);

      console.log("\n[TEST] Summary:");
      console.log(`   Installed: ${manifest.backend.length + manifest.frontend.length}`);
      console.log(`   - Backend: ${manifest.backend.length}`);
      console.log(`   - Frontend: ${manifest.frontend.length}`);
      console.log(`   Loaded by the backend: ${loadedNames.size}`);
    },
  );
});
