import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const CATALOG_INDEX_REFS = ".catalog-index-refs";
const SCALPRUM_MANIFEST = "dist-scalprum/plugin-manifest.json";
const MF_REMOTE_ENTRY = "dist/remoteEntry.js";

/** Parses a JSON file, naming it on failure rather than throwing anonymously. */
function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`Malformed ${path}`, { cause });
  }
}

/** A property of an unknown value, or undefined when the value is not an object. */
function prop(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

/** A string property of an unknown value, or undefined when absent or not a string. */
function stringProp(value: unknown, key: string): string | undefined {
  const property = prop(value, key);
  return typeof property === "string" ? property : undefined;
}

export type PluginEntry = {
  name: string;
  version: string;
  dirName: string;
  path: string;
};

export type InstalledPlugins = {
  backend: PluginEntry[];
  frontend: PluginEntry[];
};

export type FrontendBundleError = {
  plugin: PluginEntry;
  error: string;
};

/**
 * install-dynamic-plugins emits no manifest file, so the plugin set is
 * reconstructed by scanning the install directory for package.json files.
 */
export function scanInstalledPlugins(installDir: string): InstalledPlugins {
  const backend: PluginEntry[] = [];
  const frontend: PluginEntry[] = [];

  for (const entry of readdirSync(installDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginPath = join(installDir, entry.name);
    const pkgPath = join(pluginPath, "package.json");
    // Skip non-plugin directories (e.g. extracted catalog-entities/)
    if (!existsSync(pkgPath)) continue;

    // A truncated package.json is exactly the broken-install symptom this check
    // exists to catch, so readJsonFile names the file.
    const pkg = readJsonFile(pkgPath);
    const role = stringProp(prop(pkg, "backstage"), "role");

    const isFrontend =
      role === undefined
        ? existsSync(join(pluginPath, "dist-scalprum")) ||
          existsSync(join(pluginPath, MF_REMOTE_ENTRY))
        : role.startsWith("frontend");

    const manifestEntry: PluginEntry = {
      name: stringProp(pkg, "name") ?? entry.name,
      version: stringProp(pkg, "version") ?? "unknown",
      dirName: entry.name,
      path: pluginPath,
    };
    if (isFrontend) {
      frontend.push(manifestEntry);
    } else {
      backend.push(manifestEntry);
    }
  }

  if (backend.length + frontend.length === 0) {
    throw new Error(
      `No installed plugins found in ${installDir}.\n\nPopulate it with:\n\n  ${catalogIndexPopulateCommand()}\n`,
    );
  }

  return { backend, frontend };
}

/**
 * The populate command to suggest when dynamic-plugins-root is unusable. The
 * default index tracks main; a release branch carries its own version tag, so
 * honour CATALOG_INDEX_IMAGE when the caller already set one.
 */
export function catalogIndexPopulateCommand(): string {
  const image = process.env.CATALOG_INDEX_IMAGE;
  const ref =
    image === undefined || image === "" ? "quay.io/rhdh/plugin-catalog-index:next" : image;
  return `CATALOG_INDEX_IMAGE=${ref} ./e2e-tests/local-harness/populate-catalog-index.sh`;
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
 * `populate.sh`). Returns null when absent; callers that require the breadcrumb
 * should use requireCatalogIndexExpectation instead of re-deriving the message.
 *
 * @internal exported for unit tests.
 */
export function readCatalogIndexExpectation(installDir: string): CatalogIndexExpectation | null {
  const refsPath = join(installDir, CATALOG_INDEX_REFS);
  if (!existsSync(refsPath)) return null;

  let image = "";
  let expectedOciPackages = Number.NaN;
  for (const line of readFileSync(refsPath, "utf8").split("\n")) {
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim();
    if (key === "image") image = value;
    // Digits only: Number("") is 0, and Number("13.9")/Number("-1") would give a
    // count the install can never match.
    if (key === "expected_oci_packages" && /^\d+$/u.test(value)) {
      expectedOciPackages = Number(value);
    }
  }

  if (image === "" || Number.isNaN(expectedOciPackages) || expectedOciPackages <= 0) {
    throw new Error(
      `Malformed ${refsPath}: expected 'image=' and a positive 'expected_oci_packages=' count`,
    );
  }
  return { image, expectedOciPackages };
}

/**
 * The breadcrumb, or a fatal error naming how to produce it. Sole owner of the
 * "populated from the catalog index" invariant, so the global setup and the spec
 * cannot report the same failure two different ways.
 */
export function requireCatalogIndexExpectation(installDir: string): CatalogIndexExpectation {
  const expectation = readCatalogIndexExpectation(installDir);
  if (expectation === null) {
    throw new Error(
      `dynamic-plugins-root was not populated from the catalog index ` +
        `(${join(installDir, CATALOG_INDEX_REFS)} is missing).\n\n` +
        `Re-populate it with:\n\n  ${catalogIndexPopulateCommand()}\n`,
    );
  }
  return expectation;
}

/**
 * The name a frontend plugin registers with the scalprum backend, read from its
 * own dist-scalprum/plugin-manifest.json. Differs from the npm package name
 * (e.g. `backstage-community.plugin-tekton`). Null for module-federation (NFS)
 * plugins, which the scalprum backend does not register.
 */
export function readScalprumName(plugin: PluginEntry): string | null {
  const manifestPath = join(plugin.path, SCALPRUM_MANIFEST);
  if (!existsSync(manifestPath)) return null;

  const name = stringProp(readJsonFile(manifestPath), "name");
  if (name === undefined) {
    throw new Error(`${manifestPath} has no string "name"`);
  }
  return name;
}

/**
 * Frontend plugins ship either the scalprum bundle (dist-scalprum/, which
 * carries a plugin-manifest.json) or the module-federation one used by New
 * Frontend System plugins (dist/remoteEntry.js).
 *
 * @internal validateFrontendBundles is the production entry point; this is
 * exported for unit tests.
 */
export function validateFrontendBundle(plugin: PluginEntry): string | null {
  const has = (rel: string) => existsSync(join(plugin.path, rel));

  if (!has("dist-scalprum") && !has(MF_REMOTE_ENTRY)) {
    return "missing both dist-scalprum/ and dist/remoteEntry.js - needs at least one";
  }

  if (has("dist-scalprum") && !has(SCALPRUM_MANIFEST)) {
    return "dist-scalprum/ found but missing plugin-manifest.json";
  }

  return null;
}

export function validateFrontendBundles(plugins: PluginEntry[]): FrontendBundleError[] {
  const errors: FrontendBundleError[] = [];
  for (const plugin of plugins) {
    const error = validateFrontendBundle(plugin);
    if (error !== null) {
      errors.push({ plugin, error });
    }
  }
  return errors;
}
