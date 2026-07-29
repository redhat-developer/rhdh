/**
 * Plugin Dynamic Loading Sanity Check (RHIDP-13508).
 * See "Plugin Sanity Check" in e2e-tests/README.md; runs only via
 * playwright.plugin-sanity.config.ts.
 */

import { test, expect } from "@support/coverage/test";

import {
  fetchScalprumPluginNames,
  RhdhDynamicPluginsApi,
} from "../support/api/dynamic-plugins-api";
import { dynamicPluginsRoot, isCI } from "../support/local-harness-servers";
import {
  readScalprumName,
  requireCatalogIndexExpectation,
  scanInstalledPlugins,
  validateFrontendBundles,
} from "../utils/installed-plugins";

const installed = () => scanInstalledPlugins(dynamicPluginsRoot);
const allInstalled = () => {
  const { backend, frontend } = installed();
  return [...backend, ...frontend];
};

/**
 * Names present in `expected` but missing from `present`, logging each one so
 * the CI log names the culprits instead of only the assertion diff.
 */
function missingFrom<T>(
  expected: T[],
  present: Set<string>,
  lookup: (entry: T) => string,
  describe: (entry: T) => string,
  label: string,
): T[] {
  const missing = expected.filter((entry) => !present.has(lookup(entry)));
  if (missing.length > 0) {
    console.log(`\n[TEST] ${label} (${missing.length}):`);
    for (const entry of missing) {
      console.log(`   - ${describe(entry)}`);
    }
  }
  return missing;
}

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

    // Locally the harness may be populated without the env var. In CI it is
    // always set, and skipping there would leave the breadcrumb unpinned while
    // the count test below still trusted it.
    test.skip(
      !isCI && (requested === undefined || requested === ""),
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
    const api = await RhdhDynamicPluginsApi.build(request);
    const loaded = await api.loadedPluginNames();

    const notLoaded = missingFrom(
      expected,
      loaded,
      (plugin) => plugin.name,
      (plugin) => `${plugin.name}@${plugin.version} (${plugin.dirName})`,
      "Installed but not loaded",
    );
    expect(
      notLoaded.map((plugin) => plugin.name),
      "every installed plugin should be loaded by the backend",
    ).toEqual([]);
  });

  test("every frontend plugin ships valid bundle artifacts", () => {
    const { frontend } = installed();
    expect(
      frontend.length,
      "the index should declare frontend plugins to validate",
    ).toBeGreaterThan(0);

    const errors = validateFrontendBundles(frontend);

    expect(
      errors.map(({ plugin, error }) => `${plugin.name}: ${error}`),
      "every frontend plugin should ship valid bundle artifacts",
    ).toEqual([]);
  });

  test("every scalprum frontend plugin is served by the backend", async ({ request }) => {
    // Only dist-scalprum plugins are served this way; module-federation (NFS)
    // plugins are not registered by the scalprum backend at all.
    // flatMap rather than map+filter so scalprumName narrows to string.
    const expected = installed().frontend.flatMap((plugin) => {
      const scalprumName = readScalprumName(plugin);
      return scalprumName === null ? [] : [{ plugin, scalprumName }];
    });

    // Guard against a green-but-empty pass, the same trap the installed-count
    // assertion exists for.
    expect(
      expected.length,
      "the index should declare dist-scalprum frontend plugins to check",
    ).toBeGreaterThan(0);

    const served = await fetchScalprumPluginNames(request);

    const notServed = missingFrom(
      expected,
      served,
      (entry) => entry.scalprumName,
      (entry) => `${entry.plugin.name} (scalprum name: ${entry.scalprumName})`,
      "Installed but not served by scalprum",
    );
    expect(
      notServed.map((entry) => entry.plugin.name),
      "every dist-scalprum frontend plugin should be served at /api/scalprum/plugins",
    ).toEqual([]);
  });
});
