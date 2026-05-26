import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { InstallException } from './errors.js';
import { log } from './log.js';
import { type OciImageCache } from './image-cache.js';
import { npmPluginKey } from './npm-key.js';
import { ociPluginKey, type ParsedOciKey, tryParseOciRegistryAndPath } from './oci-key.js';
import {
  type DynamicPluginsConfig,
  OCI_PROTO,
  type Plugin,
  type PluginMap,
  type PluginSpec,
  RECOGNIZED_ALGORITHMS,
} from './types.js';
import { isPlainObject } from './util.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Safely assign `value` to `dst[key]` without touching the prototype chain.
 *
 * Two layers of defense:
 *   1. The `FORBIDDEN_KEYS` guard rejects `__proto__`, `constructor`, and
 *      `prototype` outright — even though `Object.defineProperty` would not
 *      pollute the prototype (it bypasses the `__proto__` setter and writes
 *      an own descriptor), CodeQL pattern-matches the assignment in
 *      isolation, so the explicit guard here is what makes the analyzer
 *      happy and gives us defense-in-depth against future callers.
 *   2. `Object.defineProperty` over `dst[key] = value` so that even if a
 *      forbidden key somehow slipped through, the prototype chain is still
 *      not mutated.
 */
function safeSet(dst: Record<string, unknown>, key: string, value: unknown): void {
  if (FORBIDDEN_KEYS.has(key)) return;
  Object.defineProperty(dst, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Recursively merges `src` into `dst` in place and returns `dst`. Raises on
 * conflicting scalar values so duplicate plugin configs never silently
 * overwrite each other (matches the Python `merge()` contract).
 *
 * Skips `__proto__`, `constructor`, and `prototype` keys to prevent prototype
 * pollution via user-supplied YAML.
 */
export function deepMerge<T extends Record<string, unknown>>(
  src: Record<string, unknown>,
  dst: T,
  prefix = '',
): T {
  for (const [key, value] of Object.entries(src)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const dstRecord = dst as Record<string, unknown>;
    if (isPlainObject(value)) {
      const existing = dstRecord[key];
      const node = isPlainObject(existing) ? existing : {};
      safeSet(dstRecord, key, node);
      deepMerge(value, node, `${prefix}${key}.`);
    } else {
      if (key in dst && !isEqual(dstRecord[key], value)) {
        throw new InstallException(
          `Config key '${prefix}${key}' defined differently for 2 dynamic plugins`,
        );
      }
      safeSet(dstRecord, key, value);
    }
  }
  return dst;
}

/**
 * Read a dynamic-plugins config file (main or included), parse its `plugins`,
 * and merge each into `allPlugins` using the OCI or NPM merger as appropriate.
 */
export async function mergePluginsFromFile(
  configFile: string,
  allPlugins: PluginMap,
  level: number,
  imageCache?: OciImageCache,
): Promise<void> {
  const content = parseYaml(await fs.readFile(configFile, 'utf8')) as unknown;
  if (!isPlainObject(content)) {
    throw new InstallException(`${configFile} must contain a mapping`);
  }
  const plugins = (content as DynamicPluginsConfig).plugins;
  if (!Array.isArray(plugins)) {
    throw new InstallException(
      `${configFile} must contain a 'plugins' list (got ${typeof plugins})`,
    );
  }
  for (const plugin of plugins) {
    await mergePlugin(plugin, allPlugins, configFile, level, imageCache);
  }
}

export async function mergePlugin(
  plugin: Plugin,
  allPlugins: PluginMap,
  configFile: string,
  level: number,
  imageCache?: OciImageCache,
): Promise<void> {
  if (typeof plugin.package !== 'string') {
    throw new InstallException(
      `content of the 'plugins.package' field must be a string in ${configFile}`,
    );
  }
  if (plugin.package.startsWith(OCI_PROTO)) {
    await mergeOciPlugin(plugin, allPlugins, configFile, level, imageCache);
  } else {
    mergeNpmPlugin(plugin, allPlugins, configFile, level);
  }
}

function mergeNpmPlugin(
  plugin: Plugin,
  allPlugins: PluginMap,
  configFile: string,
  level: number,
): void {
  const key = npmPluginKey(plugin.package);
  doMerge(key, plugin, allPlugins, configFile, level);
}

async function mergeOciPlugin(
  plugin: Plugin,
  allPlugins: PluginMap,
  configFile: string,
  level: number,
  imageCache: OciImageCache | undefined,
): Promise<void> {
  let parsed = await ociPluginKey(plugin.package, imageCache);

  if (parsed.inherit && parsed.resolvedPath === null) {
    parsed = resolveInherit(plugin, allPlugins, parsed);
  } else if (!plugin.package.includes('!') && parsed.resolvedPath) {
    plugin.package = `${plugin.package}!${parsed.resolvedPath}`;
  }

  plugin.version = parsed.version;

  const existing = allPlugins[parsed.pluginKey];
  if (!existing) {
    if (parsed.inherit) {
      throw new InstallException(
        `ERROR: {{inherit}} tag is set and there is currently no resolved tag or digest ` +
          `for ${plugin.package} in ${configFile}.`,
      );
    }
    log(
      `\n======= Adding new dynamic plugin configuration for version \`${parsed.version}\` of ${parsed.pluginKey}`,
    );
    plugin.last_modified_level = level;
    allPlugins[parsed.pluginKey] = plugin;
    return;
  }

  log(`\n======= Overriding dynamic plugin configuration ${parsed.pluginKey}`);
  if (existing.last_modified_level === level) {
    throw new InstallException(
      `Duplicate plugin configuration for ${plugin.package} found in ${configFile}.`,
    );
  }

  if (!parsed.inherit) {
    existing.package = plugin.package;
    if (existing.version !== parsed.version) {
      log(
        `INFO: Overriding version for ${parsed.pluginKey} from \`${existing.version ?? ''}\` to \`${parsed.version}\``,
      );
    }
    existing.version = parsed.version;
  }
  copyPluginFields(plugin, existing, ['package', 'version', 'last_modified_level']);
  existing.last_modified_level = level;
}

/**
 * Resolve `{{inherit}}` without a plugin path — finds a single previously-
 * merged plugin from the same image, adopts its version + path, and mutates
 * `plugin.package` in place. Throws with a helpful message when zero or
 * multiple matches are found.
 */
function resolveInherit(plugin: Plugin, allPlugins: PluginMap, parsed: ParsedOciKey): ParsedOciKey {
  const prefix = `${parsed.pluginKey}:!`;
  const matches = Object.keys(allPlugins).filter(k => k.startsWith(prefix));
  if (matches.length === 0) {
    throw new InstallException(
      `Cannot use {{inherit}} for ${parsed.pluginKey}: no existing plugin ` +
        `configuration found. Ensure a plugin from this image is defined in an ` +
        `included file with an explicit version.`,
    );
  }
  if (matches.length > 1) {
    const formatted = matches
      .map(m => {
        const baseVersion = allPlugins[m]?.version ?? '';
        const registryPart = m.split(':!')[0] ?? '';
        const pathPart = m.split(':!').at(-1) ?? '';
        return `  - ${registryPart}:${baseVersion}!${pathPart}`;
      })
      .join('\n');
    throw new InstallException(
      `Cannot use {{inherit}} for ${parsed.pluginKey}: multiple plugins from ` +
        `this image are defined in the included files:\n${formatted}\n` +
        `Please specify which plugin configuration to inherit from using: ` +
        `${parsed.pluginKey}:{{inherit}}!<plugin_path>`,
    );
  }
  const matchedKey = matches[0] as string;
  const basePlugin = allPlugins[matchedKey];
  if (!basePlugin?.version) {
    throw new InstallException(`Internal: inherited plugin ${matchedKey} has no version`);
  }
  const version = basePlugin.version;
  const resolvedPath = matchedKey.split(':!').at(-1) ?? '';
  const registryPart = matchedKey.split(':!')[0] ?? '';
  plugin.package = `${registryPart}:${version}!${resolvedPath}`;
  log(
    `\n======= Inheriting version \`${version}\` and plugin path \`${resolvedPath}\` for ${matchedKey}`,
  );
  return { pluginKey: matchedKey, version, inherit: true, resolvedPath };
}

function doMerge(
  key: string,
  plugin: Plugin,
  allPlugins: PluginMap,
  configFile: string,
  level: number,
): void {
  const existing = allPlugins[key];
  if (!existing) {
    log(`\n======= Adding new dynamic plugin configuration for ${key}`);
    plugin.last_modified_level = level;
    allPlugins[key] = plugin;
    return;
  }
  log(`\n======= Overriding dynamic plugin configuration ${key}`);
  if (existing.last_modified_level === level) {
    throw new InstallException(
      `Duplicate plugin configuration for ${plugin.package} found in ${configFile}.`,
    );
  }
  copyPluginFields(plugin, existing, ['last_modified_level']);
  existing.last_modified_level = level;
}

function copyPluginFields(src: Plugin, dst: Plugin, skip: ReadonlyArray<string>): void {
  const skipSet = new Set<string>(skip);
  Object.assign(
    dst,
    Object.fromEntries(
      Object.entries(src).filter(([k]) => !skipSet.has(k) && !FORBIDDEN_KEYS.has(k)),
    ),
  );
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) return isArrayEqual(a, b);
  if (isPlainObject(a) && isPlainObject(b)) return isObjectEqual(a, b);
  return false;
}

function isArrayEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => isEqual(v, b[i]));
}

function isObjectEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(k => isEqual(a[k], b[k]));
}

export type IncludePluginList = readonly [file: string, plugins: readonly PluginSpec[]];

type EntryState = { disabled: boolean; level: number };

/**
 * Pre-merge pass that walks every OCI plugin entry from the included files
 * (level 0) and the main config (level 1) and returns the set of OCI
 * registries that will be effectively disabled after the merge. Computed
 * BEFORE any skopeo work so disabled plugins never trigger a remote fetch.
 *
 * Ports `pre_merge_oci_disabled_state` from the Python installer
 * (`install-dynamic-plugins.py`). Only inspects `package` and `disabled` —
 * does NOT merge `pluginConfig`.
 *
 * Throws an `InstallException` for:
 *   - invalid OCI package strings on enabled entries,
 *   - duplicate enabled OCI entries declared at the same level,
 *   - path-less enabled references that collide with multiple explicit-path
 *     entries from the same image (ambiguous).
 *
 * Logs a warning (and skips the offending entry) for the equivalent
 * `disabled: true` scenarios — operators can still ship a disabled
 * descriptor without aborting the install.
 */
export function preMergeOciDisabledState(
  includePluginLists: ReadonlyArray<IncludePluginList>,
  mainPlugins: ReadonlyArray<PluginSpec>,
  mainConfigFile: string,
): Set<string> {
  const perEntryState = new Map<string, EntryState>();
  const pathlessRegistries = new Map<string, string>();
  const definedPaths = new Map<string, Map<string, string>>();

  const keyOf = (registry: string, path: string | null): string =>
    `${registry} ${path ?? ''}`;

  const processEntry = (plugin: PluginSpec, level: number, sourceFile: string): void => {
    const pkg = plugin.package;
    if (typeof pkg !== 'string' || !pkg.startsWith(OCI_PROTO)) return;
    const disabled = plugin.disabled === true;
    const parsed = tryParseOciRegistryAndPath(pkg);
    if (!parsed) {
      if (disabled) {
        log(
          `WARNING: Skipping disabled OCI plugin with invalid format: '${pkg}' in ${sourceFile}. ` +
            `Expected format: '${OCI_PROTO}<registry>:<tag>' or '${OCI_PROTO}<registry>@<algo>:<digest>' ` +
            `(optionally followed by '!<path>') where <registry> may include a port (e.g. host:5000/path) ` +
            `and <algo> is one of ${RECOGNIZED_ALGORITHMS.join(', ')}`,
        );
        return;
      }
      throw new InstallException(
        `oci package '${pkg}' is not in the expected format '${OCI_PROTO}<registry>:<tag>' ` +
          `or '${OCI_PROTO}<registry>@<algo>:<digest>' (optionally followed by '!<path>') in ${sourceFile} ` +
          `where <registry> may include a port (e.g. host:5000/path) ` +
          `and <algo> is one of ${RECOGNIZED_ALGORITHMS.join(', ')}`,
      );
    }
    const { registry, path } = parsed;
    const entryKey = keyOf(registry, path);
    const existing = perEntryState.get(entryKey);
    if (!existing) {
      perEntryState.set(entryKey, { disabled, level });
    } else if (existing.level === level) {
      const pathSuffix = path ? `!${path}` : '';
      if (disabled) {
        log(
          `WARNING: Skipping duplicate disabled OCI plugin configuration for ${registry}${pathSuffix} in ${sourceFile}`,
        );
        return;
      }
      throw new InstallException(
        `Duplicate OCI plugin configuration for ${registry}${pathSuffix} ` +
          `found at the same level in ${sourceFile}: ${pkg}`,
      );
    } else if (level > existing.level) {
      perEntryState.set(entryKey, { disabled, level });
    }

    if (path) {
      let bucket = definedPaths.get(registry);
      if (!bucket) {
        bucket = new Map<string, string>();
        definedPaths.set(registry, bucket);
      }
      bucket.set(path, sourceFile);
    } else {
      pathlessRegistries.set(registry, sourceFile);
    }
  };

  for (const [file, plugins] of includePluginLists) {
    for (const plugin of plugins) processEntry(plugin, 0, file);
  }
  for (const plugin of mainPlugins) processEntry(plugin, 1, mainConfigFile);

  for (const [registry, pathlessSource] of pathlessRegistries) {
    const bucket = definedPaths.get(registry);
    if (!bucket || bucket.size <= 1) continue;
    const formatted = [...bucket.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([p, src]) => `${p} (in ${src})`)
      .join('\n  - ');
    const pathlessState = perEntryState.get(keyOf(registry, null));
    if (pathlessState?.disabled) {
      log(
        `WARNING: Skipping disabled ambiguous path-less OCI reference for ${registry} in ${pathlessSource}: ` +
          `multiple path-specific entries exist:\n  - ${formatted}\n` +
          `Cannot use path-less syntax for multi-plugin images. ` +
          `Please specify a !<plugin-path> suffix for the plugin`,
      );
      continue;
    }
    throw new InstallException(
      `Ambiguous path-less OCI reference for ${registry} in ${pathlessSource}: ` +
        `multiple path-specific entries exist:\n  - ${formatted}\n` +
        `Cannot use path-less syntax for multi-plugin images. ` +
        `Please specify a !<plugin-path> suffix for the plugin.`,
    );
  }

  const disabledRegistries = new Set<string>();
  for (const registry of pathlessRegistries.keys()) {
    const pathlessState = perEntryState.get(keyOf(registry, null));
    if (!pathlessState) continue;
    let effectiveDisabled = pathlessState.disabled;
    const bucket = definedPaths.get(registry);
    if (bucket && bucket.size === 1) {
      const singlePath = bucket.keys().next().value as string;
      const definedState = perEntryState.get(keyOf(registry, singlePath));
      if (definedState && definedState.level > pathlessState.level) {
        effectiveDisabled = definedState.disabled;
      }
    }
    if (effectiveDisabled) disabledRegistries.add(registry);
  }

  return disabledRegistries;
}

/**
 * Drop every OCI plugin whose registry is in the disabled set, plus invalid
 * OCI entries flagged `disabled: true` (a no-op the operator clearly intends
 * to remove). Non-OCI entries pass through unchanged.
 */
export function filterDisabledOciPlugins(
  plugins: ReadonlyArray<PluginSpec>,
  disabledRegistries: ReadonlySet<string>,
): PluginSpec[] {
  const out: PluginSpec[] = [];
  for (const plugin of plugins) {
    const pkg = plugin.package;
    if (typeof pkg === 'string' && pkg.startsWith(OCI_PROTO)) {
      const parsed = tryParseOciRegistryAndPath(pkg);
      if (parsed && disabledRegistries.has(parsed.registry)) {
        log(`\n======= Disabling OCI plugin ${pkg}`);
        continue;
      }
      if (!parsed && plugin.disabled === true) {
        log(`\n======= Disabling OCI plugin ${pkg}`);
        continue;
      }
    }
    out.push(plugin);
  }
  return out;
}
