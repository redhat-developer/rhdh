import type { JsonObject } from "@backstage/types";
import type { LoadedPlugin, PluginError, PluginManifest } from "./types";
import { KNOWN_FAILURES } from "./config";

export function reportLoadErrors(errors: PluginError[]): void {
  console.error("\n=== Plugin Load Errors ===");
  for (const { plugin, error } of errors) {
    console.error(`  FAILED: ${plugin.name}@${plugin.version} (${plugin.dirName})`);
    console.error(`    ${error}`);
  }
  console.error("========================\n");
}

export function reportStartupFailure(
  err: unknown,
  loaded: LoadedPlugin[],
  config: JsonObject,
): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("\n=== BACKSTAGE STARTUP FAILED ===");
  console.error(`Error: ${msg}`);
  console.error("\nPlugins loaded:");
  for (const { plugin } of loaded) {
    console.error(`  - ${plugin.name}@${plugin.version} (${plugin.dirName})`);
  }
  console.error("\nConfig keys:", Object.keys(config).join(", "));
  console.error("================================\n");
}

export function reportSuccess(loaded: LoadedPlugin[]): void {
  console.log("\n=== Loaded Backend Plugins ===");
  for (const { plugin } of loaded) {
    console.log(`  OK: ${plugin.name}@${plugin.version} (${plugin.role})`);
  }
  console.log("=============================\n");
}

export function reportFrontend(
  total: number,
  errors: PluginError[],
  valid: { name: string; version: string }[],
): void {
  if (errors.length > 0) {
    console.error("\n=== Frontend Bundle Errors ===");
    for (const { plugin, error } of errors) {
      console.error(`  INVALID: ${plugin.name}@${plugin.version} — ${error}`);
    }
    console.error("============================\n");
  }

  console.log(`\nFrontend: ${total - errors.length}/${total} valid`);
  for (const p of valid) {
    console.log(`  OK: ${p.name}@${p.version}`);
  }
}

export function reportSummary(manifest: PluginManifest): void {
  const total = manifest.backend.length + manifest.frontend.length;
  console.log("\n=== Plugin Loadability Report ===");
  console.log(`Total: ${total} (backend: ${manifest.backend.length}, frontend: ${manifest.frontend.length})`);
  console.log(`Skipped: ${KNOWN_FAILURES.size}`);
  console.log(`Tested: ${total - KNOWN_FAILURES.size}`);
  console.log("================================\n");
}
