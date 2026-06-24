/**
 * Plugin Dynamic Loading Test (Comprehensive Loading Validation)
 *
 * This is a COMPREHENSIVE test that actually downloads and loads plugins from the
 * catalog index, validating they work with a real Backstage backend. This is the
 * "full validation" counterpart to plugin-sanity-check.spec.ts.
 *
 * Test Strategy:
 * 1. Download plugins from catalog index using @red-hat-developer-hub/cli-module-install-dynamic-plugins
 * 2. Load backend plugins and verify they have valid default exports
 * 3. Start test backend with @backstage/backend-test-utils (validates plugins actually work)
 * 4. Validate frontend plugins have required bundle artifacts
 *
 * Runtime: ~3 minutes for extraction + ~2 seconds for backend startup validation.
 *
 * IMPORTANT: This test provides comprehensive validation that complements
 * plugin-sanity-check.spec.ts:
 * - plugin-sanity-check.spec.ts: Fast format validation (~seconds)
 * - This test: Full loading validation (~3 minutes)
 *
 * Both tests run in nightly CI and catch different types of issues:
 * - Format/structure errors → caught by plugin-sanity-check.spec.ts
 * - Loading/runtime errors → caught by this test
 *
 * Based on POC from PR #4523 but modernized to use @red-hat-developer-hub/cli-module-install-dynamic-plugins
 * instead of the Python script.
 */

import { test, expect } from "@support/coverage/test";
import { startTestBackend, mockServices } from "@backstage/backend-test-utils";
import catalogPlugin from "@backstage/plugin-catalog-backend";
import scaffolderPlugin from "@backstage/plugin-scaffolder-backend";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  loadManifest,
  loadBackendPlugins,
  validateFrontendBundle,
} from "../utils/plugin-loader";
import { buildMergedConfig, KNOWN_FAILURES } from "../utils/plugin-config";
import type { PluginError } from "../utils/plugin-types";
import {
  reportCatalogIndex,
  reportDownloadStarted,
  reportDownloadCompleted,
  reportCliVerification,
  reportCliCommand,
  reportCliFailure,
  reportManifestLoaded,
  reportBackendLoadingStarted,
  reportLoadErrors,
  reportBackendStartupStarted,
  reportBackendSuccess,
  reportStartupFailure,
  reportFrontendValidationStarted,
  reportFrontendValidation,
  reportSummary,
} from "../utils/plugin-reporter";
import { patchModuleResolution } from "../utils/module-resolution-patch";

// eslint-disable-next-line @typescript-eslint/naming-convention -- ESM compatibility requires __filename/__dirname
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line @typescript-eslint/naming-convention -- ESM compatibility requires __filename/__dirname
const __dirname = dirname(__filename);

// Patch module resolution once before all tests.
// NOTE: Safe because showcase-sanity-plugins runs serially (no parallel workers).
patchModuleResolution(join(__dirname, "..", "..", "node_modules"));

const coreFeatures = [catalogPlugin, scaffolderPlugin];

test.describe("Plugin Dynamic Loading", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test(
    "All plugins from catalog index load and backend starts",
    { tag: "@sanity" },
    async ({}, testInfo) => {
      // Skip test if CATALOG_INDEX_IMAGE is not set
      // This test requires the catalog index to download plugins from.
      // In nightly CI (showcase-sanity-plugins), this env var is always set.
      // In PR checks (showcase), this test is excluded via testIgnore.
      if (!process.env.CATALOG_INDEX_IMAGE) {
        testInfo.skip(
          true,
          "CATALOG_INDEX_IMAGE not set - skipping external catalog download. " +
            "This test only runs in nightly jobs where CATALOG_INDEX_IMAGE is configured.",
        );
        return;
      }

      // 5 minutes timeout: ~3 min plugin download + ~2s backend startup + 2 min buffer
      test.setTimeout(300_000);

      // Get catalog index image from environment (now guaranteed to exist)
      const catalogIndexImage = process.env.CATALOG_INDEX_IMAGE;

      reportCatalogIndex(catalogIndexImage);

      // Create temporary directories
      const tempDir = await mkdtemp(join(tmpdir(), "rhdh-plugin-test-"));
      const dynamicPluginsRoot = join(tempDir, "dynamic-plugins-root");

      try {
        // Step 1: Create minimal dynamic-plugins.yaml to trigger catalog index extraction
        await mkdir(dynamicPluginsRoot, { recursive: true });

        // Empty plugins list triggers catalog index extraction via CATALOG_INDEX_IMAGE env var
        const dynamicPluginsConfig = `plugins: []`;
        await writeFile(
          join(dynamicPluginsRoot, "dynamic-plugins.yaml"),
          dynamicPluginsConfig,
        );

        reportDownloadStarted();

        // Step 2: Verify CLI package is available
        try {
          const cliVersion = execSync(
            "npx @red-hat-developer-hub/cli-module-install-dynamic-plugins --version",
            { encoding: "utf-8", stdio: "pipe" },
          ).trim();
          reportCliVerification(cliVersion);
        } catch (versionError) {
          console.error("❌ CLI not available:", versionError.message);
          throw new Error(
            `CLI @red-hat-developer-hub/cli-module-install-dynamic-plugins not available`,
          );
        }

        // Step 3: Run install-dynamic-plugins
        const installCmd = `npx @red-hat-developer-hub/cli-module-install-dynamic-plugins install ${dynamicPluginsRoot}`;

        reportCliCommand(installCmd, catalogIndexImage);

        try {
          execSync(installCmd, {
            env: {
              ...process.env,
              CATALOG_INDEX_IMAGE: catalogIndexImage,
            },
            stdio: "inherit",
          });
        } catch (error) {
          const exitCode = error.status || error.code || "unknown";
          reportCliFailure(exitCode);
          throw new Error(
            `install-dynamic-plugins failed (exit ${exitCode}). Check logs above for details.`,
          );
        }

        reportDownloadCompleted();

        // Step 4: Load manifest
        const manifest = loadManifest(dynamicPluginsRoot);
        reportManifestLoaded(manifest.backend.length, manifest.frontend.length);

        // Filter out known failures
        const backendPlugins = manifest.backend.filter(
          (p) => !KNOWN_FAILURES.has(p.dirName),
        );
        const frontendPlugins = manifest.frontend.filter(
          (p) => !KNOWN_FAILURES.has(p.dirName),
        );

        // Step 5: Load backend plugins
        reportBackendLoadingStarted(backendPlugins.length);
        const { loaded, errors: loadErrors } =
          loadBackendPlugins(backendPlugins);

        reportLoadErrors(loadErrors);
        expect(loaded.length).toBeGreaterThan(0);

        // Step 6: Build config and start test backend
        reportBackendStartupStarted();
        const config = buildMergedConfig(loaded);
        const features = [
          ...coreFeatures,
          ...loaded.map((p) => p.feature),
          mockServices.rootConfig.factory({ data: config }),
        ];

        let backend;
        try {
          backend = await startTestBackend({
            features,
          });

          reportBackendSuccess(loaded);

          // Stop backend
          await backend.stop();
        } catch (err) {
          reportStartupFailure(err, loaded, config);
          throw err;
        }

        // Fail test if there were load errors
        if (loadErrors.length > 0) {
          throw new Error(
            `${loadErrors.length} plugin(s) failed to load:\n` +
              loadErrors
                .map((e) => `  - ${e.plugin.name}: ${e.error}`)
                .join("\n"),
          );
        }

        // Step 7: Validate frontend plugins
        reportFrontendValidationStarted(frontendPlugins.length);
        const frontendErrors: PluginError[] = [];
        const validFrontend: { name: string; version: string }[] = [];

        for (const plugin of frontendPlugins) {
          const error = validateFrontendBundle(plugin);
          if (error) {
            frontendErrors.push({ plugin, error });
          } else {
            validFrontend.push({ name: plugin.name, version: plugin.version });
          }
        }

        reportFrontendValidation(
          frontendPlugins.length,
          frontendErrors,
          validFrontend,
        );

        expect(frontendErrors).toEqual([]);

        // Step 8: Report summary
        reportSummary(manifest, loaded.length, validFrontend.length);

        expect(
          manifest.backend.length + manifest.frontend.length,
        ).toBeGreaterThan(0);
      } finally {
        // Cleanup
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );
});
