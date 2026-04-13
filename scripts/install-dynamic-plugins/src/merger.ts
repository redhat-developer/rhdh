import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { InstallException } from './errors.js';
import { log } from './log.js';
import { type OciImageCache } from './image-cache.js';
import { npmPluginKey } from './npm-key.js';
import { ociPluginKey } from './oci-key.js';
import { type DynamicPluginsConfig, OCI_PROTO, type Plugin, type PluginMap } from './types.js';

/**
 * Recursively merges `src` into `dst` in place and returns `dst`. Raises on
 * conflicting scalar values so duplicate plugin configs never silently
 * overwrite each other (matches the Python `merge()` contract).
 *
 * Skips `__proto__`, `constructor`, and `prototype` keys to prevent prototype
 * pollution via user-supplied YAML.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge<T extends Record<string, unknown>>(
  src: Record<string, unknown>,
  dst: T,
  prefix = '',
): T {
  for (const [key, value] of Object.entries(src)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (isPlainObject(value)) {
      const existing = (dst as Record<string, unknown>)[key];
      const node = isPlainObject(existing) ? existing : {};
      (dst as Record<string, unknown>)[key] = node;
      deepMerge(value, node as Record<string, unknown>, `${prefix}${key}.`);
    } else {
      if (key in dst && !isEqual((dst as Record<string, unknown>)[key], value)) {
        throw new InstallException(
          `Config key '${prefix}${key}' defined differently for 2 dynamic plugins`,
        );
      }
      (dst as Record<string, unknown>)[key] = value;
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
    // {{inherit}} without a path: find a single earlier-included plugin from
    // the same image (key starts with `registry:!`) and adopt its version + path.
    const matches = Object.keys(allPlugins).filter(k => k.startsWith(`${parsed.pluginKey}:!`));
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
          const basePlugin = allPlugins[m];
          const baseVersion = basePlugin?.version ?? '';
          const registryPart = m.split(':!')[0];
          const pathPart = m.split(':!').slice(-1)[0];
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
    const basePlugin = allPlugins[matchedKey] as Plugin;
    const version = basePlugin.version as string;
    const resolvedPath = matchedKey.split(':!').slice(-1)[0] as string;
    const registryPart = matchedKey.split(':!')[0] as string;
    plugin.package = `${registryPart}:${version}!${resolvedPath}`;
    parsed = { pluginKey: matchedKey, version, inherit: true, resolvedPath };
    log(
      `\n======= Inheriting version \`${version}\` and plugin path \`${resolvedPath}\` for ${matchedKey}`,
    );
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
    plugin._level = level;
    allPlugins[parsed.pluginKey] = plugin;
    return;
  }

  log(`\n======= Overriding dynamic plugin configuration ${parsed.pluginKey}`);
  if (existing._level === level) {
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
  copyPluginFields(plugin, existing, ['package', 'version', '_level']);
  existing._level = level;
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
    plugin._level = level;
    allPlugins[key] = plugin;
    return;
  }
  log(`\n======= Overriding dynamic plugin configuration ${key}`);
  if (existing._level === level) {
    throw new InstallException(
      `Duplicate plugin configuration for ${plugin.package} found in ${configFile}.`,
    );
  }
  copyPluginFields(plugin, existing, ['_level']);
  existing._level = level;
}

function copyPluginFields(
  src: Plugin,
  dst: Plugin,
  skip: ReadonlyArray<keyof Plugin | string>,
): void {
  const skipSet = new Set<string>(skip);
  Object.assign(
    dst,
    Object.fromEntries(
      Object.entries(src).filter(([k]) => !skipSet.has(k) && !FORBIDDEN_KEYS.has(k)),
    ),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!isEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
