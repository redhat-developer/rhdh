#!/usr/bin/env node
/**
 * OCI package parsing (image ref, digest) for plugin entries.
 * Usage:
 *   oci-parse.cjs parse <package> <dynamic_plugins_file> <pathsJson>
 * pathsJson: JSON array of plugin paths from manifest (for auto-detect), or "null"
 */
'use strict';

const OCI_PROTOCOL_PREFIX = 'oci://';
const EXPECTED_OCI_PATTERN = new RegExp(
  '^(' +
    OCI_PROTOCOL_PREFIX +
    '[^\\s/:@]+' +
    '(?::\\d+)?' +
    '(?:/[^\\s:@]+)+' +
  ')' +
  '(?:' +
    ':([^\\s!@:]+)' +
    '|' +
    '@((?:sha256|sha512|blake3):[^\\s!@:]+)' +
  ')' +
  '(?:!([^\\s]+))?$'
);

function parsePluginKey(package_, dynamicPluginsFile, pathsFromManifest) {
  const m = package_.match(EXPECTED_OCI_PATTERN);
  if (!m) {
    throw new Error(
      `oci package '${package_}' is not in the expected format in ${dynamicPluginsFile}`
    );
  }
  const registry = m[1];
  const tagVersion = m[2];
  const digestVersion = m[3];
  const version = tagVersion || digestVersion;
  let path = m[4];

  const inheritVersion = tagVersion === '{{inherit}}' && digestVersion == null;

  if (inheritVersion && !path) {
    return {
      plugin_key: registry,
      version,
      inherit_version: true,
      resolved_path: null,
      full_image: null
    };
  }

  if (!path) {
    const fullImage = tagVersion ? `${registry}:${version}` : `${registry}@${version}`;
    if (!pathsFromManifest || pathsFromManifest.length === 0) {
      throw new Error(
        `No plugins found in OCI image ${fullImage}.`
      );
    }
    if (pathsFromManifest.length > 1) {
      const pluginsList = pathsFromManifest.join('\n  - ');
      throw new Error(
        `Multiple plugins found in OCI image ${fullImage}:\n  - ${pluginsList}\n` +
        `Please specify which plugin to install using the syntax: ${fullImage}!<plugin-name>`
      );
    }
    path = pathsFromManifest[0];
    return {
      plugin_key: `${registry}:!${path}`,
      version,
      inherit_version: false,
      resolved_path: path,
      full_image: fullImage
    };
  }

  const pluginKey = `${registry}:!${path}`;
  return {
    plugin_key: pluginKey,
    version,
    inherit_version: inheritVersion,
    resolved_path: path,
    full_image: null
  };
}

const cmd = process.argv[2];
if (cmd === 'parse') {
  const package_ = process.argv[3];
  const file = process.argv[4];
  let pathsJson = process.argv[5] || 'null';
  let paths = null;
  try {
    paths = JSON.parse(pathsJson);
  } catch {
    paths = null;
  }
  try {
    const r = parsePluginKey(package_, file, paths);
    console.log(JSON.stringify(r));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else {
  console.error('usage: oci-parse.cjs parse <package> <file> <pathsJson>');
  process.exit(2);
}
