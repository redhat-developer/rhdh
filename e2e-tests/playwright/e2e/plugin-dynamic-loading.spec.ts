/**
 * Plugin Dynamic Loading Test
 *
 * Validates that all dynamic plugins from the RHDH catalog index can be loaded
 * and that the RHDH backend starts successfully.
 *
 * Test Strategy:
 * 1. Use @red-hat-developer-hub/cli-module-install-dynamic-plugins to download plugins from catalog index
 * 2. Load backend plugins and verify they have valid default exports
 * 3. Start test backend with @backstage/backend-test-utils
 * 4. Validate frontend plugins have required bundle artifacts
 *
 * This provides comprehensive plugin validation without requiring a full cluster deployment.
 * Runtime: ~3 minutes for extraction + ~2 seconds for backend startup validation.
 *
 * Based on POC from PR #4523 but modernized to use @red-hat-developer-hub/cli-module-install-dynamic-plugins
 * instead of the Python script.
 */

import { test, expect } from "@support/coverage/test";
import { startTestBackend, mockServices } from "@backstage/backend-test-utils";
import catalogPlugin from "@backstage/plugin-catalog-backend";
import scaffolderPlugin from "@backstage/plugin-scaffolder-backend";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  loadManifest,
  loadBackendPlugins,
  validateFrontendBundle,
  buildMergedConfig,
  KNOWN_FAILURES,
  type PluginError,
} from "../utils/plugin-loader";
import { patchModuleResolution } from "../utils/module-resolution-patch";

// Patch module resolution once before all tests
patchModuleResolution(join(__dirname, "..", "..", "node_modules"));

const CORE_FEATURES = [catalogPlugin, scaffolderPlugin];

test.describe("Plugin Dynamic Loading", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test("All plugins from catalog index load and backend starts", { tag: "@sanity" }, async () => {
    test.setTimeout(300_000); // 5 minutes timeout for download + test

    // Get catalog index image from environment
    const catalogIndexImage =
      process.env.CATALOG_INDEX_IMAGE || "quay.io/rhdh/plugin-catalog-index:1.10";

    console.log(
      `\n📦 Testing plugins from catalog index: ${catalogIndexImage}\n`
    );

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
        dynamicPluginsConfig
      );

      console.log("📥 Downloading plugins from catalog index...");

      // Step 2: Run install-dynamic-plugins to extract all plugins
      const installCmd = `npx @red-hat-developer-hub/cli-module-install-dynamic-plugins ${dynamicPluginsRoot}`;

      execSync(installCmd, {
        env: {
          ...process.env,
          CATALOG_INDEX_IMAGE: catalogIndexImage,
        },
        stdio: "pipe",
      });

      console.log("✅ Plugins downloaded successfully\n");

      // Step 3: Load manifest
      const manifest = loadManifest(dynamicPluginsRoot);
      console.log(
        `📋 Manifest loaded: ${manifest.backend.length} backend, ${manifest.frontend.length} frontend plugins\n`
      );

      // Filter out known failures
      const backendPlugins = manifest.backend.filter(
        (p) => !KNOWN_FAILURES.has(p.dirName)
      );
      const frontendPlugins = manifest.frontend.filter(
        (p) => !KNOWN_FAILURES.has(p.dirName)
      );

      // Step 4: Load backend plugins
      console.log(`🔌 Loading ${backendPlugins.length} backend plugins...`);
      const { loaded, errors: loadErrors } = loadBackendPlugins(backendPlugins);

      if (loadErrors.length > 0) {
        console.log(`\n⚠️  Load errors (${loadErrors.length}):`);
        loadErrors.forEach((e) => {
          console.log(`   - ${e.plugin.name}: ${e.error}`);
        });
      }

      expect(loaded.length).toBeGreaterThan(0);
      console.log(`✅ ${loaded.length} backend plugins loaded successfully\n`);

      // Step 5: Build config and start test backend
      console.log("🚀 Starting test backend with loaded plugins...");
      const config = buildMergedConfig(loaded);
      const features: any[] = [
        ...CORE_FEATURES,
        ...loaded.map((p) => p.feature),
        mockServices.rootConfig.factory({ data: config }),
      ];

      let backend;
      try {
        backend = await startTestBackend({
          features,
        });

        console.log("✅ Backend started successfully with all plugins!\n");

        // Stop backend
        await backend.stop();
      } catch (err) {
        console.error("\n❌ Backend startup failed:");
        console.error(err);
        console.error("\nLoaded plugins:");
        loaded.forEach((p) => {
          console.error(`  - ${p.plugin.name} (${p.plugin.version})`);
        });
        console.error("\nMerged config:");
        console.error(JSON.stringify(config, null, 2));
        throw err;
      }

      // Fail test if there were load errors
      if (loadErrors.length > 0) {
        throw new Error(
          `${loadErrors.length} plugin(s) failed to load:\n` +
            loadErrors.map((e) => `  - ${e.plugin.name}: ${e.error}`).join("\n")
        );
      }

      // Step 6: Validate frontend plugins
      console.log(`🎨 Validating ${frontendPlugins.length} frontend plugins...`);
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

      if (frontendErrors.length > 0) {
        console.log(`\n⚠️  Frontend validation errors (${frontendErrors.length}):`);
        frontendErrors.forEach((e) => {
          console.log(`   - ${e.plugin.name}: ${e.error}`);
        });
      }

      console.log(`✅ ${validFrontend.length} frontend plugins validated\n`);

      expect(frontendErrors).toEqual([]);

      // Step 7: Report summary
      const total = manifest.backend.length + manifest.frontend.length;
      const skipped = KNOWN_FAILURES.size;
      const tested = total - skipped;
      const succeeded = loaded.length + validFrontend.length;

      console.log("📊 Summary:");
      console.log(`   Total plugins: ${total}`);
      console.log(`   Known failures (skipped): ${skipped}`);
      console.log(`   Tested: ${tested}`);
      console.log(`   Succeeded: ${succeeded}`);
      console.log(
        `   Success rate: ${((succeeded / tested) * 100).toFixed(1)}%\n`
      );

      expect(total).toBeGreaterThan(0);
    } finally {
      // Cleanup
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
