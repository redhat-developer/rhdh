/**
 * Plugin Loading Reporter
 *
 * Consistent logging and reporting for plugin loading tests.
 */

import type { JsonObject } from "@backstage/types";
import type { LoadedPlugin, PluginError, PluginManifest } from "./plugin-types";
import { KNOWN_FAILURES } from "./plugin-config";

/**
 * Report plugin load errors
 */
export function reportLoadErrors(errors: PluginError[]): void {
  if (errors.length === 0) return;

  console.log(`\n⚠️  Plugin load errors (${errors.length}):`);
  for (const { plugin, error } of errors) {
    console.log(`   - ${plugin.name}: ${error}`);
  }
}

/**
 * Report backend startup failure
 */
export function reportStartupFailure(
  err: unknown,
  loaded: LoadedPlugin[],
  config: JsonObject,
): void {
  console.error("\n❌ Backend startup failed:");
  console.error(err);
  console.error("\nLoaded plugins:");
  for (const { plugin } of loaded) {
    console.error(`  - ${plugin.name} (${plugin.version})`);
  }
  console.error("\nMerged config:");
  console.error(JSON.stringify(config, null, 2));
}

/**
 * Report successful backend plugin loading
 */
export function reportBackendSuccess(loaded: LoadedPlugin[]): void {
  console.log(`✅ ${loaded.length} backend plugins loaded successfully`);
  console.log("✅ Backend started successfully with all plugins!\n");
}

/**
 * Report frontend validation results
 */
export function reportFrontendValidation(
  total: number,
  errors: PluginError[],
  valid: Array<{ name: string; version: string }>,
): void {
  if (errors.length > 0) {
    console.log(`\n⚠️  Frontend validation errors (${errors.length}):`);
    for (const { plugin, error } of errors) {
      console.log(`   - ${plugin.name}: ${error}`);
    }
  }

  console.log(`✅ ${valid.length}/${total} frontend plugins validated\n`);
}

/**
 * Report final summary statistics
 */
export function reportSummary(
  manifest: PluginManifest,
  backendLoaded: number,
  frontendValid: number,
): void {
  const totalBackend = manifest.backend.length;
  const totalFrontend = manifest.frontend.length;
  const total = totalBackend + totalFrontend;
  const skipped = KNOWN_FAILURES.size;
  const tested = total - skipped;
  const succeeded = backendLoaded + frontendValid;

  console.log("📊 Summary:");
  console.log(`   Total plugins: ${total}`);
  console.log(`   - Backend: ${totalBackend}`);
  console.log(`   - Frontend: ${totalFrontend}`);
  console.log(`   Known failures (skipped): ${skipped}`);
  console.log(`   Tested: ${tested}`);
  console.log(`   Succeeded: ${succeeded}`);
  console.log(`   Success rate: ${((succeeded / tested) * 100).toFixed(1)}%\n`);
}

/**
 * Report catalog index being tested
 */
export function reportCatalogIndex(catalogIndexImage: string): void {
  console.log(
    `\n📦 Testing plugins from catalog index: ${catalogIndexImage}\n`,
  );
}

/**
 * Report manifest loading
 */
export function reportManifestLoaded(
  backendCount: number,
  frontendCount: number,
): void {
  console.log(
    `📋 Manifest loaded: ${backendCount} backend, ${frontendCount} frontend plugins\n`,
  );
}

/**
 * Report plugin download started
 */
export function reportDownloadStarted(): void {
  console.log("📥 Downloading plugins from catalog index...");
}

/**
 * Report plugin download completed
 */
export function reportDownloadCompleted(): void {
  console.log("✅ Plugins downloaded successfully\n");
}

/**
 * Report backend loading started
 */
export function reportBackendLoadingStarted(count: number): void {
  console.log(`🔌 Loading ${count} backend plugins...`);
}

/**
 * Report backend startup started
 */
export function reportBackendStartupStarted(): void {
  console.log("🚀 Starting test backend with loaded plugins...");
}

/**
 * Report frontend validation started
 */
export function reportFrontendValidationStarted(count: number): void {
  console.log(`🎨 Validating ${count} frontend plugins...`);
}

/**
 * Report CLI verification
 */
export function reportCliVerification(version: string): void {
  console.log("🔍 Verifying install-dynamic-plugins CLI...");
  console.log(`✓ CLI version: ${version}`);
}

/**
 * Report CLI command execution
 */
export function reportCliCommand(
  command: string,
  catalogIndexImage: string,
): void {
  console.log(`Command: ${command}`);
  console.log(`CATALOG_INDEX_IMAGE: ${catalogIndexImage}`);
}

/**
 * Report CLI failure
 */
export function reportCliFailure(exitCode: string | number): void {
  console.error(`\n❌ CLI failed with exit code: ${exitCode}`);
  console.error("⚠️  Error output was printed above (stdio='inherit')");
}
