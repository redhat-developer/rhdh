/**
 * Plugin Loader Utilities
 *
 * Helpers for the plugin sanity check (plugin-dynamic-loading.spec.ts):
 * enumerate the plugins installed into dynamic-plugins-root by
 * install-dynamic-plugins, validate frontend bundle artifacts, and parse the
 * dynamic-plugins-info loaded-plugins response.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export type PluginRole = "backend" | "frontend";

export type PluginEntry = {
  name: string;
  version: string;
  dirName: string;
  path: string;
  role: PluginRole;
};

export type PluginManifest = {
  backend: PluginEntry[];
  frontend: PluginEntry[];
};

export type PluginError = {
  plugin: PluginEntry;
  error: string;
};

/**
 * Build the plugin manifest from an install-dynamic-plugins output directory.
 *
 * The CLI does not emit a manifest file - each installed plugin is a
 * directory containing its package.json. Scan those directories and classify
 * plugins by their backstage.role (falling back to bundle layout when the
 * role is absent).
 */
export function loadManifest(installDir: string): PluginManifest {
  const backend: PluginEntry[] = [];
  const frontend: PluginEntry[] = [];

  for (const entry of readdirSync(installDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginPath = join(installDir, entry.name);
    const pkgPath = join(pluginPath, "package.json");
    // Skip non-plugin directories (e.g. extracted catalog-entities/)
    if (!existsSync(pkgPath)) continue;

    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    let name = entry.name;
    let version = "unknown";
    let role: string | undefined;
    if (typeof pkg === "object" && pkg !== null) {
      if ("name" in pkg && typeof pkg.name === "string") {
        name = pkg.name;
      }
      if ("version" in pkg && typeof pkg.version === "string") {
        version = pkg.version;
      }
      if (
        "backstage" in pkg &&
        typeof pkg.backstage === "object" &&
        pkg.backstage !== null &&
        "role" in pkg.backstage &&
        typeof pkg.backstage.role === "string"
      ) {
        role = pkg.backstage.role;
      }
    }

    const isFrontend =
      role === undefined
        ? existsSync(join(pluginPath, "dist-scalprum")) ||
          existsSync(join(pluginPath, "dist", "remoteEntry.js"))
        : !role.includes("backend");

    const manifestEntry: PluginEntry = {
      name,
      version,
      dirName: entry.name,
      path: pluginPath,
      role: isFrontend ? "frontend" : "backend",
    };
    if (isFrontend) {
      frontend.push(manifestEntry);
    } else {
      backend.push(manifestEntry);
    }
  }

  if (backend.length + frontend.length === 0) {
    throw new Error(
      `No installed plugins found in ${installDir}. ` +
        `Populate it first (with CATALOG_INDEX_IMAGE set): ` +
        `./e2e-tests/local-harness/populate-catalog-index.sh`,
    );
  }

  return { backend, frontend };
}

export type CatalogIndexExpectation = {
  image: string;
  expectedOciPackages: number;
};

/**
 * Read the `.catalog-index-refs` breadcrumb written by
 * local-harness/populate-catalog-index.sh, which records the index image and
 * how many oci:// packages that run resolved.
 *
 * Without it the sanity check only asserts "installed ⊆ loaded", which stays
 * green when the install silently underran (registry hiccup, over-broad
 * exclude pattern, or dynamic-plugins-root left over from the curated
 * `populate.sh`). Returns null when absent so a local curated run fails with a
 * clear message rather than a type error.
 */
export function readCatalogIndexExpectation(installDir: string): CatalogIndexExpectation | null {
  const refsPath = join(installDir, ".catalog-index-refs");
  if (!existsSync(refsPath)) return null;

  let image = "";
  let expectedOciPackages = Number.NaN;
  for (const line of readFileSync(refsPath, "utf8").split("\n")) {
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim();
    if (key === "image") image = value;
    // Number("") is 0, so an empty value must stay NaN for the check below.
    if (key === "expected_oci_packages" && value !== "") {
      expectedOciPackages = Math.trunc(Number(value));
    }
  }

  if (image === "" || Number.isNaN(expectedOciPackages)) {
    throw new Error(`Malformed ${refsPath}: expected 'image=' and 'expected_oci_packages=' lines`);
  }
  return { image, expectedOciPackages };
}

/**
 * Validate that a frontend plugin has required bundle artifacts
 *
 * Frontend plugins use either:
 * - Modern: dist-scalprum/ with plugin-manifest.json
 * - Legacy: dist/remoteEntry.js (no manifest needed)
 */
export function validateFrontendBundle(plugin: PluginEntry): string | null {
  const has = (rel: string) => existsSync(join(plugin.path, rel));

  if (!has("package.json")) {
    return "missing package.json";
  }

  // Must have at least one bundle format
  if (!has("dist-scalprum") && !has("dist/remoteEntry.js")) {
    return "missing both dist-scalprum/ and dist/remoteEntry.js - needs at least one";
  }

  // Modern dist-scalprum format requires plugin-manifest.json
  if (has("dist-scalprum") && !has("dist-scalprum/plugin-manifest.json")) {
    return "dist-scalprum/ found but missing plugin-manifest.json";
  }

  return null;
}

/**
 * Validate bundle artifacts for a list of frontend plugins
 */
export function validateFrontendBundles(plugins: PluginEntry[]): PluginError[] {
  const errors: PluginError[] = [];
  for (const plugin of plugins) {
    const error = validateFrontendBundle(plugin);
    if (error !== null) {
      errors.push({ plugin, error });
    }
  }
  return errors;
}

/**
 * Array.isArray narrows `unknown` to `any[]`; this guard keeps elements typed
 * as `unknown` so downstream access stays type-checked.
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Parse the /api/dynamic-plugins-info/loaded-plugins response into the set of
 * loaded plugin package names. Throws when the payload is not the expected
 * array shape, so schema drift fails loudly instead of as a false mismatch.
 */
export function parseLoadedPluginNames(body: unknown): Set<string> {
  if (!isUnknownArray(body)) {
    throw new Error(`Expected loaded-plugins response to be an array, got: ${typeof body}`);
  }

  const names = new Set<string>();
  for (const item of body) {
    if (
      typeof item === "object" &&
      item !== null &&
      "name" in item &&
      typeof item.name === "string"
    ) {
      names.add(item.name);
    } else {
      // Silently dropping a malformed entry would surface later as a
      // confusing "installed but not loaded" mismatch - fail at the cause.
      throw new Error(`loaded-plugins item without a string name: ${JSON.stringify(item)}`);
    }
  }
  return names;
}
