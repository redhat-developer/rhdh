export const PullPolicy = {
  IF_NOT_PRESENT: 'IfNotPresent',
  ALWAYS: 'Always',
} as const;

export type PullPolicy = (typeof PullPolicy)[keyof typeof PullPolicy];

/**
 * External schema — the fields a user may declare in `dynamic-plugins.yaml`.
 * Keep this in sync with RHDH documentation.
 */
export type PluginSpec = {
  package: string;
  disabled?: boolean;
  pullPolicy?: PullPolicy;
  forceDownload?: boolean;
  integrity?: string;
  pluginConfig?: Record<string, unknown>;
};

/**
 * Internal plugin record. Extends the YAML schema with fields populated at
 * runtime (`version` from the package string, `plugin_hash` for change
 * detection, `last_modified_level` to track include-file precedence).
 *
 * The field name `last_modified_level` matches the Python implementation so
 * the install hashes computed by `plugin-hash.ts` stay byte-compatible
 * across the Python ↔ TS migration. Renaming it would force every existing
 * dynamic-plugins-root to be re-installed on the first TS run.
 */
export type Plugin = PluginSpec & {
  version?: string;
  plugin_hash?: string;
  last_modified_level?: number;
};

export type PluginMap = Record<string, Plugin>;

export type DynamicPluginsConfig = {
  includes?: string[];
  plugins?: PluginSpec[];
};

export const DOCKER_PROTO = 'docker://';
export const OCI_PROTO = 'oci://';
/**
 * Tag suffix that, by convention, opts an OCI plugin into `pullPolicy: Always`
 * when no explicit policy is set — mirrors the Python script's behaviour and
 * keeps the two implementations swappable. Always parsed in combination with
 * the `!plugin-path` separator so a plugin tagged `:latest` (no plugin path)
 * does not accidentally trigger.
 */
export const LATEST_TAG_MARKER = ':latest!';
export const RHDH_REGISTRY = 'registry.access.redhat.com/rhdh/';
export const RHDH_FALLBACK = 'quay.io/rhdh/';
export const CONFIG_HASH_FILE = 'dynamic-plugin-config.hash';
export const IMAGE_HASH_FILE = 'dynamic-plugin-image.hash';
export const DPDY_FILENAME = 'dynamic-plugins.default.yaml';
export const LOCK_FILENAME = 'install-dynamic-plugins.lock';
export const GLOBAL_CONFIG_FILENAME = 'app-config.dynamic-plugins.yaml';

const DEFAULT_MAX_ENTRY_SIZE = 20_000_000;

/**
 * Parse the MAX_ENTRY_SIZE env var, falling back to the default when unset,
 * non-numeric, or < 1. Exported for unit tests — the `MAX_ENTRY_SIZE` constant
 * below is the module-level value used by the extractors.
 */
export function parseMaxEntrySize(raw: string | undefined = process.env.MAX_ENTRY_SIZE): number {
  if (!raw) return DEFAULT_MAX_ENTRY_SIZE;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_ENTRY_SIZE;
}

export const MAX_ENTRY_SIZE = parseMaxEntrySize();
export const RECOGNIZED_ALGORITHMS = ['sha512', 'sha384', 'sha256'] as const;
export type Algorithm = (typeof RECOGNIZED_ALGORITHMS)[number];
