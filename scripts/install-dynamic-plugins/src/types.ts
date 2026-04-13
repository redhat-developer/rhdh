export const PullPolicy = {
  IF_NOT_PRESENT: 'IfNotPresent',
  ALWAYS: 'Always',
} as const;

export type PullPolicy = (typeof PullPolicy)[keyof typeof PullPolicy];

export type Plugin = {
  package: string;
  disabled?: boolean;
  pullPolicy?: PullPolicy;
  forceDownload?: boolean;
  integrity?: string;
  pluginConfig?: Record<string, unknown>;
  version?: string;
  /** Computed at runtime by computePluginHash(). */
  plugin_hash?: string;
  /** Internal: include-file nesting level. 0 = included file, 1 = main file. */
  _level?: number;
};

export type PluginMap = Record<string, Plugin>;

export type DynamicPluginsConfig = {
  includes?: string[];
  plugins?: Plugin[];
};

export const DOCKER_PROTO = 'docker://';
export const OCI_PROTO = 'oci://';
export const RHDH_REGISTRY = 'registry.access.redhat.com/rhdh/';
export const RHDH_FALLBACK = 'quay.io/rhdh/';
export const CONFIG_HASH_FILE = 'dynamic-plugin-config.hash';
export const IMAGE_HASH_FILE = 'dynamic-plugin-image.hash';
export const DPDY_FILENAME = 'dynamic-plugins.default.yaml';
export const LOCK_FILENAME = 'install-dynamic-plugins.lock';
export const GLOBAL_CONFIG_FILENAME = 'app-config.dynamic-plugins.yaml';

export const MAX_ENTRY_SIZE = Number(process.env.MAX_ENTRY_SIZE ?? 20_000_000);
export const RECOGNIZED_ALGORITHMS = ['sha512', 'sha384', 'sha256'] as const;
export type Algorithm = (typeof RECOGNIZED_ALGORITHMS)[number];
