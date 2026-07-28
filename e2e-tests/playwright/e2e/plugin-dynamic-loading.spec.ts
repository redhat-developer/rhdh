/**
 * Plugin Dynamic Loading Sanity Check (RHIDP-13508).
 * See "Plugin Sanity Check" in e2e-tests/README.md; runs only via
 * playwright.plugin-sanity.config.ts.
 */

import { test, expect } from "@support/coverage/test";

import { parseRefreshToken } from "../support/api/rhdh-auth-api-hack";
import { dynamicPluginsRoot } from "../support/local-harness-servers";
import {
  parseLoadedPluginNames,
  readCatalogIndexExpectation,
  scanInstalledPlugins,
  validateFrontendBundles,
} from "../utils/plugin-loader";

test.describe("Plugin Dynamic Loading", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test("all catalog index plugins load in the RHDH backend", async ({ request }) => {
    const manifest = scanInstalledPlugins(dynamicPluginsRoot);
    console.log(
      `[TEST] Installed: ${manifest.backend.length} backend, ${manifest.frontend.length} frontend plugins`,
    );

    const expected = [...manifest.backend, ...manifest.frontend];

    // The count check below is what catches a partial install; without it
    // this spec only asserts "installed ⊆ loaded" and passes trivially.
    // Throw rather than assert-and-return: a bare `return` here would report
    // the test as PASSED without having validated anything.
    const indexExpectation = readCatalogIndexExpectation(dynamicPluginsRoot);
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
    const token = parseRefreshToken(await refresh.json());

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
        console.log(`   - ${plugin.name}@${plugin.version} (${plugin.dirName})`);
      }
      console.log("\nLoaded plugins reported by the backend:");
      for (const name of [...loadedNames].toSorted()) {
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
  });
});
