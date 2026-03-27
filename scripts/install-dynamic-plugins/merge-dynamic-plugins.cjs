#!/usr/bin/env node
/**
 * Merges NPM/OCI plugin entries (merge_plugin / PackageMerger behavior).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const YQ = process.env.YQ || 'yq';

function yqToJson(filePath) {
  return JSON.parse(
    execFileSync(YQ, ['eval', '-o=json', filePath], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    })
  );
}

function parseNpmKey(pkg) {
  return execFileSync(
    process.execPath,
    [path.join(SCRIPT_DIR, 'npm-parse-plugin-key.cjs'), pkg],
    { encoding: 'utf8' }
  ).trim();
}

function getOciPluginPaths(fullImage) {
  const sh = path.join(SCRIPT_DIR, 'install-dynamic-plugins.sh');
  const out = execFileSync(
    'bash',
    [sh, '--get-oci-paths', fullImage],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
  return out
    .trim()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ociParse(package_, file, pathsJson) {
  try {
    const out = execFileSync(
      process.execPath,
      [
        path.join(SCRIPT_DIR, 'oci-parse.cjs'),
        'parse',
        package_,
        file,
        pathsJson === null ? 'null' : JSON.stringify(pathsJson)
      ],
      { encoding: 'utf8' }
    ).trim();
    return JSON.parse(out);
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString()) || e.message || String(e);
    throw new Error(msg.trim());
  }
}

class NpmMerger {
  constructor(plugin, file, allPlugins) {
    this.plugin = plugin;
    this.file = file;
    this.allPlugins = allPlugins;
  }

  parsePluginKey(package_) {
    return parseNpmKey(package_);
  }

  mergePlugin(level) {
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
      if (this.allPlugins[pluginKey].last_modified_level === level) {
        throw new Error(
          `Duplicate plugin configuration for ${this.plugin.package} found in ${this.file}.`
        );
      }
      this.allPlugins[pluginKey].last_modified_level = level;
      for (const key of Object.keys(this.plugin)) {
        this.allPlugins[pluginKey][key] = this.plugin[key];
      }
    }
  }
}

class OciMerger {
  constructor(plugin, file, allPlugins) {
    this.plugin = plugin;
    this.file = file;
    this.allPlugins = allPlugins;
  }

  mergePlugin(level) {
    const package_ = this.plugin.package;
    if (typeof package_ !== 'string') {
      throw new Error(`content of the 'package' field must be a string in ${this.file}`);
    }

    let pathsFromManifest = null;
    if (!package_.includes('!')) {
      const ref = JSON.parse(
        execFileSync(
          process.execPath,
          [path.join(SCRIPT_DIR, 'oci-ref.cjs'), 'parse', package_],
          { encoding: 'utf8' }
        ).trim()
      );
      pathsFromManifest = getOciPluginPaths(ref.fullImage);
    }

    let parsed;
    try {
      parsed = ociParse(package_, this.file, pathsFromManifest);
    } catch (e) {
      throw new Error(e.message);
    }

    let pluginKey = parsed.plugin_key;
    let version = parsed.version;
    const inheritVersion = parsed.inherit_version;
    const resolvedPath = parsed.resolved_path;

    if (inheritVersion && resolvedPath === null) {
      const matches = Object.keys(this.allPlugins).filter((k) =>
        k.startsWith(`${pluginKey}:!`)
      );
      if (matches.length === 0) {
        throw new Error(
          `Cannot use {{inherit}} for ${pluginKey}: no existing plugin configuration found. ` +
            `Ensure a plugin from this image is defined in an included file with an explicit version.`
        );
      }
      if (matches.length > 1) {
        const fullPackages = matches.map((m) => {
          const base = this.allPlugins[m];
          const baseVersion = base.version || '';
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
      pluginKey = matches[0];
      const basePlugin = this.allPlugins[pluginKey];
      const ver = basePlugin.version;
      const rp = pluginKey.split(':!').pop();
      const registryPart = pluginKey.split(':!')[0];
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
      if (this.allPlugins[pluginKey].last_modified_level === level) {
        throw new Error(
          `Duplicate plugin configuration for ${this.plugin.package} found in ${this.file}.`
        );
      }
      this.allPlugins[pluginKey].last_modified_level = level;
      if (inheritVersion !== true) {
        this.allPlugins[pluginKey].package = this.plugin.package;
        if (this.allPlugins[pluginKey].version !== version) {
          console.error(
            `INFO: Overriding version for ${pluginKey} from \`${this.allPlugins[pluginKey].version}\` to \`${version}\``
          );
        }
        this.allPlugins[pluginKey].version = version;
      }
      for (const key of Object.keys(this.plugin)) {
        if (key === 'package' || key === 'version') continue;
        this.allPlugins[pluginKey][key] = this.plugin[key];
      }
    }
  }
}

function mergePlugin(plugin, allPlugins, dynamicPluginsFile, level) {
  const package_ = plugin.package;
  if (typeof package_ !== 'string') {
    throw new Error(`content of the 'plugins.package' field must be a string in ${dynamicPluginsFile}`);
  }
  if (package_.startsWith('oci://')) {
    new OciMerger(plugin, dynamicPluginsFile, allPlugins).mergePlugin(level);
  } else {
    new NpmMerger(plugin, dynamicPluginsFile, allPlugins).mergePlugin(level);
  }
}

function main() {
  const dynamicPluginsFile = process.argv[2];
  const catalogDefault = process.argv[3] || '';
  if (!dynamicPluginsFile) {
    console.error('usage: merge-dynamic-plugins.cjs <dynamic-plugins.yaml> [catalog-default.yaml]');
    process.exit(2);
  }
  const content = yqToJson(dynamicPluginsFile);
  if (!content || typeof content !== 'object') {
    console.log(JSON.stringify({}));
    return;
  }
  let includes = content.includes;
  if (!Array.isArray(includes)) includes = [];
  if (catalogDefault && includes.includes('dynamic-plugins.default.yaml')) {
    const idx = includes.indexOf('dynamic-plugins.default.yaml');
    includes = [...includes];
    includes[idx] = catalogDefault;
  }

  const allPlugins = {};

  for (const inc of includes) {
    if (typeof inc !== 'string') {
      throw new Error(`content of the 'includes' field must be a list of strings in ${dynamicPluginsFile}`);
    }
    console.error('\n======= Including dynamic plugins from', inc);
    const p = path.isAbsolute(inc) ? inc : path.join(process.cwd(), inc);
    if (!fs.existsSync(p)) {
      console.error(`WARNING: File ${inc} does not exist, skipping including dynamic packages from ${inc}`);
      continue;
    }
    const incContent = yqToJson(p);
    if (typeof incContent !== 'object' || incContent === null) {
      throw new Error(`${inc} content must be a YAML object`);
    }
    const plist = incContent.plugins;
    if (!Array.isArray(plist)) {
      throw new Error(`content of the 'plugins' field must be a list in ${inc}`);
    }
    for (const plugin of plist) {
      mergePlugin(plugin, allPlugins, p, 0);
    }
  }

  let plugins = content.plugins;
  if (!Array.isArray(plugins)) plugins = [];
  for (const plugin of plugins) {
    mergePlugin(plugin, allPlugins, dynamicPluginsFile, 1);
  }

  console.log(JSON.stringify(allPlugins));
}

main();
