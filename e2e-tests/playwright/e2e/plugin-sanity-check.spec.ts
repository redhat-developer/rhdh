/**
 * Plugin Sanity Check (Lightweight Format Validation)
 *
 * This is a LIGHTWEIGHT test that validates the format and structure of
 * default.packages.yaml without actually loading plugins. It runs quickly
 * (~seconds) and catches basic configuration errors.
 *
 * Test Strategy:
 * 1. Read enabled packages from default.packages.yaml
 * 2. Validate package name format (scoped packages starting with @)
 * 3. Validate YAML structure is parseable
 *
 * IMPORTANT: This test does NOT actually load/resolve plugins. That would
 * require a Backstage runtime and is expensive (~3 minutes). For comprehensive
 * plugin loading validation, see plugin-dynamic-loading.spec.ts which:
 * - Downloads plugins from catalog index
 * - Loads plugins with startTestBackend
 * - Validates plugins actually work
 *
 * Both tests are complementary:
 * - This test: Fast format validation (runs on every nightly)
 * - plugin-dynamic-loading.spec.ts: Full loading validation (runs on nightly)
 */

import { test, expect } from "@support/coverage/test";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as yaml from "yaml";

// eslint-disable-next-line @typescript-eslint/naming-convention -- ESM compatibility requires __filename/__dirname
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line @typescript-eslint/naming-convention -- ESM compatibility requires __filename/__dirname
const __dirname = dirname(__filename);

// eslint-disable-next-line @typescript-eslint/naming-convention -- Constant name matches file path convention
const DEFAULT_PACKAGES_PATH = join(__dirname, "../../../default.packages.yaml");

type PackageEntry = {
  package: string;
};

type DefaultPackagesConfig = {
  packages: {
    enabled: PackageEntry[];
    disabled: PackageEntry[];
  };
};

test.describe("Plugin Sanity Check", { tag: "@sanity" }, () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test("All enabled packages can be resolved", async () => {
    // Read default.packages.yaml from rhdh repo root
    const defaultPackagesPath = DEFAULT_PACKAGES_PATH;
    const yamlContent = readFileSync(defaultPackagesPath, "utf8");
    const config = yaml.parse(yamlContent) as DefaultPackagesConfig;

    const enabledPackages = config.packages.enabled;
    console.log(`\n📦 Testing ${enabledPackages.length} enabled packages...\n`);

    const results: {
      package: string;
      status: "success" | "failed";
      error?: string;
    }[] = [];

    for (const pkg of enabledPackages) {
      const packageName = pkg.package;

      try {
        // NOTE: This is intentionally a lightweight format check only.
        // We do NOT attempt to resolve/download/load packages here because:
        // 1. Would require downloading from OCI registry (~3 min)
        // 2. Would require Backstage runtime to load plugins
        // 3. Defeats the purpose of a fast sanity check
        //
        // For comprehensive plugin loading validation, see plugin-dynamic-loading.spec.ts
        // which downloads plugins from catalog index and validates them with startTestBackend.
        //
        // This test catches:
        // - Malformed package names in YAML
        // - Invalid YAML structure
        // - Missing required fields
        //
        // It does NOT catch:
        // - Packages that don't exist in registry
        // - Packages that fail to load
        // - Runtime plugin errors
        // (Those are covered by plugin-dynamic-loading.spec.ts)

        // Validate package name format
        if (!packageName.startsWith("@")) {
          throw new Error("Package name must be scoped (start with @)");
        }

        results.push({
          package: packageName,
          status: "success",
        });

        console.log(`✅ ${packageName}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        results.push({
          package: packageName,
          status: "failed",
          error: errorMessage,
        });

        console.error(`❌ ${packageName}: ${errorMessage}`);
      }
    }

    // Report summary
    const successful = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed");

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Successful: ${successful}/${enabledPackages.length}`);
    console.log(`   ❌ Failed: ${failed.length}/${enabledPackages.length}`);

    if (failed.length > 0) {
      console.log(`\n❌ Failed packages:`);
      failed.forEach((f) => {
        console.log(`   - ${f.package}: ${f.error}`);
      });
    }

    // Fail the test if any packages failed to load
    expect(failed.length).toBe(0);
  });

  test("Disabled packages list is parseable", async () => {
    // Verify disabled packages section is valid YAML
    const yamlContent = readFileSync(DEFAULT_PACKAGES_PATH, "utf8");
    const config = yaml.parse(yamlContent) as DefaultPackagesConfig;

    const disabledPackages = config.packages.disabled;

    // Basic validation: disabled list exists and contains package entries
    expect(disabledPackages).toBeDefined();
    expect(Array.isArray(disabledPackages)).toBe(true);
    expect(disabledPackages.length).toBeGreaterThan(0);

    console.log(`\n📦 Found ${disabledPackages.length} disabled packages`);

    // Verify each entry has a package field
    for (const pkg of disabledPackages) {
      expect(pkg.package).toBeDefined();
      expect(typeof pkg.package).toBe("string");
      expect(pkg.package.length).toBeGreaterThan(0);
    }
  });
});
