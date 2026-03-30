/**
 * OCI package parsing (image ref, digest) for plugin entries.
 */
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

export interface OciParseResult {
  plugin_key: string;
  version: string;
  inherit_version: boolean;
  resolved_path: string | null;
  full_image: string | null;
}

export function parseOciPluginKey(
  package_: string,
  dynamicPluginsFile: string,
  pathsFromManifest: string[] | null
): OciParseResult {
  const m = package_.match(EXPECTED_OCI_PATTERN);
  if (!m) {
    throw new Error(
      `oci package '${package_}' is not in the expected format in ${dynamicPluginsFile}`
    );
  }
  const registry = m[1]!;
  const tagVersion = m[2];
  const digestVersion = m[3];
  const version = tagVersion || digestVersion!;
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
    const fullImage = tagVersion
      ? `${registry}:${version}`
      : `${registry}@${version}`;
    if (!pathsFromManifest || pathsFromManifest.length === 0) {
      throw new Error(`No plugins found in OCI image ${fullImage}.`);
    }
    if (pathsFromManifest.length > 1) {
      const pluginsList = pathsFromManifest.join('\n  - ');
      throw new Error(
        `Multiple plugins found in OCI image ${fullImage}:\n  - ${pluginsList}\n` +
          `Please specify which plugin to install using the syntax: ${fullImage}!<plugin-name>`
      );
    }
    path = pathsFromManifest[0]!;
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
