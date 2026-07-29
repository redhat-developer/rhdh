/**
 * Plugin Dynamic Loading Sanity Check (RHIDP-13508).
 * See "Plugin Sanity Check" in e2e-tests/README.md; runs only via
 * playwright.plugin-sanity.config.ts.
 */

import { test, expect } from "@support/coverage/test";

import { DynamicPluginsApi } from "../support/api/dynamic-plugins-api";
import { dynamicPluginsRoot } from "../support/local-harness-servers";
import {
  readScalprumName,
  requireCatalogIndexExpectation,
  scanInstalledPlugins,
  validateFrontendBundles,
} from "../utils/plugin-loader";

const installed = () => scanInstalledPlugins(dynamicPluginsRoot);
const allInstalled = () => {
  const { backend, frontend } = installed();
  return [...backend, ...frontend];
};

test.describe("Plugin Dynamic Loading", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test("dynamic-plugins-root was populated from the catalog index under test", () => {
    const expectation = requireCatalogIndexExpectation(dynamicPluginsRoot);
    const requested = process.env.CATALOG_INDEX_IMAGE;

    test.skip(
      requested === undefined || requested === "",
      "CATALOG_INDEX_IMAGE unset - nothing to compare the breadcrumb against",
    );
    expect(
      expectation.image,
      "dynamic-plugins-root was populated from a different catalog index than " +
        "CATALOG_INDEX_IMAGE - re-run populate-catalog-index.sh",
    ).toBe(requested);
  });

  test("every oci:// package the catalog index declares is installed", () => {
    const expectation = requireCatalogIndexExpectation(dynamicPluginsRoot);

    // Without this the suite only asserts "installed ⊆ loaded", which stays green
    // when the install silently underran.
    expect(
      allInstalled().length,
      `installed plugin count should match the ${expectation.expectedOciPackages} ` +
        `oci:// packages declared by ${expectation.image}`,
    ).toBe(expectation.expectedOciPackages);
  });

  test("every installed plugin is loaded by the backend", async ({ request }) => {
    const expected = allInstalled();
    const loaded = await (await DynamicPluginsApi.build(request)).loadedPluginNames();

    const notLoaded = expected.filter((plugin) => !loaded.has(plugin.name));
    if (notLoaded.length > 0) {
      console.log(`\n[TEST] Installed but not loaded (${notLoaded.length}):`);
      for (const plugin of notLoaded) {
        console.log(`   - ${plugin.name}@${plugin.version} (${plugin.dirName})`);
      }
      console.log("\nLoaded plugins reported by the backend:");
      for (const name of [...loaded].toSorted()) {
        console.log(`   - ${name}`);
      }
    }
    expect(
      notLoaded.map((plugin) => plugin.name),
      "every installed plugin should be loaded by the backend",
    ).toEqual([]);
  });

  test("every frontend plugin ships valid bundle artifacts", () => {
    const errors = validateFrontendBundles(installed().frontend);

    expect(
      errors.map(({ plugin, error }) => `${plugin.name}: ${error}`),
      "every frontend plugin should ship valid bundle artifacts",
    ).toEqual([]);
  });

  test("every scalprum frontend plugin is served by the backend", async ({ request }) => {
    // Only dist-scalprum plugins are served this way; legacy remoteEntry-only
    // ones are not registered by the scalprum backend at all.
    // flatMap rather than map+filter so scalprumName narrows to string.
    const expected = installed().frontend.flatMap((plugin) => {
      const scalprumName = readScalprumName(plugin);
      return scalprumName === null ? [] : [{ plugin, scalprumName }];
    });

    const served = await (await DynamicPluginsApi.build(request)).scalprumPluginNames();

    const notServed = expected.filter((entry) => !served.has(entry.scalprumName));
    if (notServed.length > 0) {
      console.log(`\n[TEST] Installed but not served by scalprum (${notServed.length}):`);
      for (const { plugin, scalprumName } of notServed) {
        console.log(`   - ${plugin.name} (scalprum name: ${scalprumName})`);
      }
    }
    expect(
      notServed.map((entry) => entry.plugin.name),
      "every dist-scalprum frontend plugin should be served at /api/scalprum/plugins",
    ).toEqual([]);
  });
});
