/**
 * Plugin Dynamic Loading Sanity Check (RHIDP-13508)
 *
 * Validates that every plugin enabled by the catalog index actually loads in
 * the real RHDH backend. Runs cluster-free: Playwright boots
 * `packages/backend` from source (playwright.plugin-sanity.config.ts), with
 * dynamic-plugins-root populated from CATALOG_INDEX_IMAGE by
 * local-harness/populate-catalog-index.sh, so the plugins go through the product's own
 * dynamicPluginsFeatureLoader — same Backstage line, same scanner, same
 * config stack as the shipped backend.
 *
 * Test strategy:
 * 1. Enumerate the installed plugins (directory scan of dynamic-plugins-root)
 * 2. Fetch what the backend really loaded (/api/dynamic-plugins-info/loaded-plugins,
 *    authenticated via the guest provider from app-config.local-e2e.yaml)
 * 3. Fail listing every installed plugin the loader did not load
 * 4. Statically validate frontend plugin bundle artifacts
 *
 * Runs only via the dedicated config (excluded from all cluster projects via
 * testIgnore). CI entrypoint: testing::run_plugin_sanity_check, called by the
 * nightly OCP handler (.ci/pipelines/jobs/ocp-nightly.sh).
 */

import { resolve } from "path";

import { test, expect } from "@support/coverage/test";

import {
  loadManifest,
  parseLoadedPluginNames,
  readCatalogIndexExpectation,
  validateFrontendBundles,
} from "../utils/plugin-loader";

// Known failures are handled at install time instead of here: a plugin that
// throws during init aborts the whole backend, so plugins that cannot load in
// this harness are filtered out by local-harness/catalog-index-refs.sh via
// local-harness/plugin-sanity-excludes.txt (each entry documents why).

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
      // Step 1: enumerate what install-dynamic-plugins installed
      const manifest = loadManifest(DYNAMIC_PLUGINS_ROOT);
      console.log(
        `📋 Installed: ${manifest.backend.length} backend, ${manifest.frontend.length} frontend plugins`,
      );

      const expected = [...manifest.backend, ...manifest.frontend];
      expect(expected.length).toBeGreaterThan(0);

      // The install must cover the WHOLE index, not just whatever happened to
      // land: a partial install would otherwise pass this spec trivially.
      const indexExpectation = readCatalogIndexExpectation(DYNAMIC_PLUGINS_ROOT);
      expect(
        indexExpectation,
        "dynamic-plugins-root was not populated from the catalog index - run " +
          "local-harness/populate-catalog-index.sh with CATALOG_INDEX_IMAGE set",
      ).not.toBeNull();
      // Narrowing for the type checker; the assertion above is the real gate.
      if (indexExpectation === null) return;

      console.log(`🗂️  Catalog index: ${indexExpectation.image}`);
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

      // Step 2: authenticate as guest (loaded-plugins requires user credentials)
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

      // Step 3: what the product's dynamic plugin loader actually loaded
      const response = await request.get("/api/dynamic-plugins-info/loaded-plugins", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status(), "loaded-plugins endpoint should respond").toBe(200);
      const loadedNames = parseLoadedPluginNames(await response.json());
      console.log(`🔌 Backend reports ${loadedNames.size} loaded dynamic plugins`);

      // Step 4: every installed plugin must have been loaded
      const notLoaded = expected.filter((plugin) => !loadedNames.has(plugin.name));
      if (notLoaded.length > 0) {
        console.log(`\n⚠️  Installed but not loaded (${notLoaded.length}):`);
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

      // Step 5: frontend bundle artifacts (static check)
      const frontendErrors = validateFrontendBundles(manifest.frontend);
      if (frontendErrors.length > 0) {
        console.log(`\n⚠️  Frontend bundle errors (${frontendErrors.length}):`);
        for (const { plugin, error } of frontendErrors) {
          console.log(`   - ${plugin.name}: ${error}`);
        }
      }
      expect(
        frontendErrors.map(({ plugin, error }) => `${plugin.name}: ${error}`),
        "every frontend plugin should ship valid bundle artifacts",
      ).toEqual([]);

      // Step 6: summary
      console.log("\n📊 Summary:");
      console.log(`   Installed: ${manifest.backend.length + manifest.frontend.length}`);
      console.log(`   - Backend: ${manifest.backend.length}`);
      console.log(`   - Frontend: ${manifest.frontend.length}`);
      console.log(`   Loaded by the backend: ${loadedNames.size}`);
    },
  );
});
