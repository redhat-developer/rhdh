/**
 * Merges NPM/OCI plugin entries (merge_plugin / PackageMerger behavior).
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parse } from 'yaml';
import { parseNpmPluginKey } from './npm-parse-plugin-key.js';
import { parseOciPluginKey } from './oci-parse.js';
import { parseOciRef } from './oci-ref.js';
import { getOciPluginPaths } from './registry-oci.js';

export interface PluginRecord {
  package: string;
  last_modified_level?: number;
  version?: string;
  [key: string]: unknown;
}

function yqToJson(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf8');
  const doc = parse(raw);
  if (doc == null || typeof doc !== 'object') {
    return {};
  }
  return doc as Record<string, unknown>;
}

function ociParse(
  package_: string,
  file: string,
  pathsJson: string[] | null
): ReturnType<typeof parseOciPluginKey> {
  return parseOciPluginKey(package_, file, pathsJson);
}

class NpmMerger {
  constructor(
    private readonly plugin: PluginRecord,
    private readonly file: string,
    private readonly allPlugins: Record<string, PluginRecord>
  ) {}

  parsePluginKey(package_: string): string {
    return parseNpmPluginKey(package_);
  }

  mergePlugin(level: number): void {
    const package_ = this.plugin.package;
    if (typeof package_ !== 'string') {
      throw new Error(`content of the 'package' field must be a string in ${this.file}`);
    }
    const pluginKey = this.parsePluginKey(package_);
    if (!(pluginKey in this.allPlugins)) {
      console.error(`\n======= Adding new dynamic plugin configuration for ${pluginKey}`);
      this.plugin.last_modified_level = level;
      this.allPlugins[pluginKey] = this.plugin;
    } else {
      console.error('\n======= Overriding dynamic plugin configuration', pluginKey);
      if (this.allPlugins[pluginKey]!.last_modified_level === level) {
        throw new Error(
          `Duplicate plugin configuration for ${this.plugin.package} found in ${this.file}.`
        );
      }
      this.allPlugins[pluginKey]!.last_modified_level = level;
      for (const key of Object.keys(this.plugin)) {
        this.allPlugins[pluginKey]![key] = this.plugin[key];
      }
    }
  }
}

class OciMerger {
  constructor(
    private readonly plugin: PluginRecord,
    private readonly file: string,
    private readonly allPlugins: Record<string, PluginRecord>
  ) {}

  async mergePlugin(level: number): Promise<void> {
    const package_ = this.plugin.package;
    if (typeof package_ !== 'string') {
      throw new Error(`content of the 'package' field must be a string in ${this.file}`);
    }

    let pathsFromManifest: string[] | null = null;
    if (!package_.includes('!')) {
      const ref = parseOciRef(package_);
      pathsFromManifest = await getOciPluginPaths(ref.fullImage);
    }

    let parsed: ReturnType<typeof parseOciPluginKey>;
    try {
      parsed = ociParse(package_, this.file, pathsFromManifest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.trim());
    }

    let pluginKey = parsed.plugin_key;
    let version = parsed.version;
    const inheritVersion = parsed.inherit_version;
    const resolvedPath = parsed.resolved_path;

    if (inheritVersion && resolvedPath === null) {
      const matches = Object.keys(this.allPlugins).filter(k =>
        k.startsWith(`${pluginKey}:!`)
      );
      if (matches.length === 0) {
        throw new Error(
          `Cannot use {{inherit}} for ${pluginKey}: no existing plugin configuration found. ` +
            `Ensure a plugin from this image is defined in an included file with an explicit version.`
        );
      }
      if (matches.length > 1) {
        const fullPackages = matches.map(m => {
          const base = this.allPlugins[m]!;
          const baseVersion = (base.version as string) || '';
          const parts = m.split(':!');
          return `${parts[0]}:${baseVersion}!${parts[1]}`;
        });
        throw new Error(
          `Cannot use {{inherit}} for ${pluginKey}: multiple plugins from this image are defined in the included files:\n  - ${fullPackages.join(
            '\n  - '
          )}\n` +
            `Please specify which plugin configuration to inherit from using: ${pluginKey}:{{inherit}}!<plugin_path>`
        );
      }
      pluginKey = matches[0]!;
      const basePlugin = this.allPlugins[pluginKey]!;
      const ver = basePlugin.version as string;
      const rp = pluginKey.split(':!').pop()!;
      const registryPart = pluginKey.split(':!')[0]!;
      version = ver;
      this.plugin.package = `${registryPart}:${version}!${rp}`;
      console.error(
        `\n======= Inheriting version \`${version}\` and plugin path \`${rp}\` for ${pluginKey}`
      );
    } else if (!package_.includes('!')) {
      this.plugin.package = `${package_}!${resolvedPath}`;
    }

    if (!(pluginKey in this.allPlugins)) {
      console.error(
        `\n======= Adding new dynamic plugin configuration for version \`${version}\` of ${pluginKey}`
      );
      this.plugin.last_modified_level = level;
      if (inheritVersion === true) {
        throw new Error(
          `ERROR: {{inherit}} tag is set and there is currently no resolved tag or digest for ${this.plugin.package} in ${this.file}.`
        );
      }
      this.plugin.version = version;
      this.allPlugins[pluginKey] = this.plugin;
    } else {
      console.error('\n======= Overriding dynamic plugin configuration', pluginKey);
      if (this.allPlugins[pluginKey]!.last_modified_level === level) {
        throw new Error(
          `Duplicate plugin configuration for ${this.plugin.package} found in ${this.file}.`
        );
      }
      this.allPlugins[pluginKey]!.last_modified_level = level;
      if (inheritVersion !== true) {
        this.allPlugins[pluginKey]!.package = this.plugin.package;
        if (this.allPlugins[pluginKey]!.version !== version) {
          console.error(
            `INFO: Overriding version for ${pluginKey} from \`${String(this.allPlugins[pluginKey]!.version)}\` to \`${version}\``
          );
        }
        this.allPlugins[pluginKey]!.version = version;
      }
      for (const key of Object.keys(this.plugin)) {
        if (key === 'package' || key === 'version') {
          continue;
        }
        this.allPlugins[pluginKey]![key] = this.plugin[key];
      }
    }
  }
}

async function mergePlugin(
  plugin: PluginRecord,
  allPlugins: Record<string, PluginRecord>,
  dynamicPluginsFile: string,
  level: number
): Promise<void> {
  const package_ = plugin.package;
  if (typeof package_ !== 'string') {
    throw new Error(
      `content of the 'plugins.package' field must be a string in ${dynamicPluginsFile}`
    );
  }
  if (package_.startsWith('oci://')) {
    await new OciMerger(plugin, dynamicPluginsFile, allPlugins).mergePlugin(level);
  } else {
    new NpmMerger(plugin, dynamicPluginsFile, allPlugins).mergePlugin(level);
  }
}

export async function mergeDynamicPlugins(
  dynamicPluginsFile: string,
  catalogDefault = ''
): Promise<Record<string, PluginRecord>> {
  const content = yqToJson(dynamicPluginsFile);
  if (!content || typeof content !== 'object') {
    return {};
  }
  let includes = content.includes as string[] | undefined;
  if (!Array.isArray(includes)) {
    includes = [];
  }
  if (catalogDefault && includes.includes('dynamic-plugins.default.yaml')) {
    const idx = includes.indexOf('dynamic-plugins.default.yaml');
    includes = [...includes];
    includes[idx] = catalogDefault;
  }

  const allPlugins: Record<string, PluginRecord> = {};

  for (const inc of includes) {
    if (typeof inc !== 'string') {
      throw new Error(
        `content of the 'includes' field must be a list of strings in ${dynamicPluginsFile}`
      );
    }
    console.error('\n======= Including dynamic plugins from', inc);
    const p = isAbsolute(inc) ? inc : join(process.cwd(), inc);
    if (!existsSync(p)) {
      console.error(
        `WARNING: File ${inc} does not exist, skipping including dynamic packages from ${inc}`
      );
      continue;
    }
    const incContent = yqToJson(p);
    if (typeof incContent !== 'object' || incContent === null) {
      throw new Error(`${inc} content must be a YAML object`);
    }
    const plist = incContent.plugins as unknown;
    if (!Array.isArray(plist)) {
      throw new Error(`content of the 'plugins' field must be a list in ${inc}`);
    }
    for (const plugin of plist as PluginRecord[]) {
      await mergePlugin(plugin, allPlugins, p, 0);
    }
  }

  let plugins = content.plugins as unknown;
  if (!Array.isArray(plugins)) {
    plugins = [];
  }
  for (const plugin of plugins as PluginRecord[]) {
    await mergePlugin(plugin, allPlugins, dynamicPluginsFile, 1);
  }

  return allPlugins;
}
