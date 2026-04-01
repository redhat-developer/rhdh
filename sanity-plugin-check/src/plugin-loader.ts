import fs from "node:fs";
import path from "node:path";
import type { PluginEntry, PluginManifest, LoadedPlugin, PluginError } from "./types";

const EXTRACT_DIR = process.env.EXTRACT_DIR || "/tmp/rhdh-sanity-plugins";
const MANIFEST_PATH = path.join(EXTRACT_DIR, "manifest.json");

export function loadManifest(): PluginManifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `Plugin manifest not found at ${MANIFEST_PATH}.\nRun: bash scripts/extract-plugins.sh`,
    );
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

export function resolveEntryPoint(pluginPath: string): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(pluginPath, "package.json"), "utf8"),
  );

  const candidates = [
    "dist/index.cjs.js",
    "dist/index.esm.js",
    "dist/index.js",
    pkg.main?.startsWith("dist/") ? pkg.main : undefined,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const full = path.join(pluginPath, c);
    if (fs.existsSync(full)) return full;
  }

  throw new Error(`No entry point in ${pluginPath}. Tried: ${candidates.join(", ")}`);
}

export function loadBackendPlugins(
  plugins: PluginEntry[],
): { loaded: LoadedPlugin[]; errors: PluginError[] } {
  const loaded: LoadedPlugin[] = [];
  const errors: PluginError[] = [];

  for (const plugin of plugins) {
    try {
      const mod = require(resolveEntryPoint(plugin.path));
      if (!mod.default) {
        errors.push({ plugin, error: "No default export" });
        continue;
      }
      loaded.push({ plugin, feature: mod.default });
    } catch (err) {
      errors.push({
        plugin,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { loaded, errors };
}

export function validateFrontendBundle(plugin: PluginEntry): string | null {
  const has = (rel: string) => fs.existsSync(path.join(plugin.path, rel));

  if (!has("package.json")) return "missing package.json";
  if (!has("dist-scalprum") && !has("dist/remoteEntry.js"))
    return "missing dist-scalprum/ and dist/remoteEntry.js";
  if (has("dist-scalprum") && !has("dist-scalprum/plugin-manifest.json"))
    return "missing dist-scalprum/plugin-manifest.json";

  return null;
}
