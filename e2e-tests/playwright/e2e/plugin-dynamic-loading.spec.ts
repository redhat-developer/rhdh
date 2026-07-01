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
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { existsSync } from "fs";
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
        // Step 1: Create dynamic-plugins-root directory
        await mkdir(dynamicPluginsRoot, { recursive: true });

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

        // Step 3a: Extract catalog index to get dynamic-plugins.default.yaml
        const installCmd = `npx @red-hat-developer-hub/cli-module-install-dynamic-plugins install .`;

        console.log("📦 Extracting catalog index...");
        try {
          execSync(installCmd, {
            cwd: dynamicPluginsRoot,
            env: {
              ...process.env,
              CATALOG_INDEX_IMAGE: catalogIndexImage,
            },
            stdio: "inherit",
          });
        } catch (error) {
          // First run extracts catalog but skips install (no dynamic-plugins.yaml)
          // This is expected - we'll copy the default file next
          console.log("✓ Catalog index extracted");
        }

        // Step 3b: Find dynamic-plugins.default.yaml (search in common cache locations)
        const targetConfig = join(dynamicPluginsRoot, "dynamic-plugins.yaml");

        // Search in multiple locations where CLI might cache the file
        const searchPaths = [
          tempDir,                    // Our temp directory
          "/tmp",                     // System temp
          process.env.HOME,           // Home directory
          join(process.env.HOME || "~", ".cache"),
          join(process.env.HOME || "~", ".npm"),
        ].filter(Boolean);

        console.log(`🔍 Searching for dynamic-plugins.default.yaml in: ${searchPaths.join(", ")}`);

        let defaultConfigPath: string | undefined;

        for (const searchPath of searchPaths) {
          try {
            const findCmd = `find "${searchPath}" -name "dynamic-plugins.default.yaml" -type f 2>/dev/null | head -1`;
            const findResult = execSync(findCmd, { encoding: "utf-8" }).trim();

            if (findResult) {
              defaultConfigPath = findResult;
              console.log(`✓ Found at: ${defaultConfigPath}`);
              break;
            }
          } catch (error) {
            // Continue searching in next path
          }
        }

        if (!defaultConfigPath) {
          console.log("\n📂 Debug: Directory contents after extraction:");
          execSync(`ls -la "${dynamicPluginsRoot}"`, { stdio: "inherit" });
          execSync(`find "${tempDir}" -type f`, { stdio: "inherit" });
          throw new Error(
            `dynamic-plugins.default.yaml not found in any cache location. Searched: ${searchPaths.join(", ")}`,
          );
        }

        const configContent = await readFile(defaultConfigPath, "utf8");
        await writeFile(targetConfig, configContent);
        console.log("✓ Copied to dynamic-plugins.yaml");

        // Step 3c: Run install again with the config file
        reportCliCommand(installCmd, catalogIndexImage);

        try {
          execSync(installCmd, {
            cwd: dynamicPluginsRoot,
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
