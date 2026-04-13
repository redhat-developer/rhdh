import { InstallException } from './errors.js';
import { log } from './log.js';
import { type OciImageCache } from './image-cache.js';
import { OCI_PROTO, RECOGNIZED_ALGORITHMS } from './types.js';

const OCI_REGEX = new RegExp(
  '^(' +
    escape(OCI_PROTO) +
    '[^\\s/:@]+' + // registry host
    '(?::\\d+)?' + // optional port
    '(?:/[^\\s:@]+)+' + // at least one path segment
    ')' +
    '(?::([^\\s!@:]+)' + // tag
    '|' +
    '@((?:sha256|sha512|blake3):[^\\s!@:]+))' + // or digest
    '(?:!([^\\s]+))?$', // optional !<plugin-path>
);

export type ParsedOciKey = {
  /** `oci://registry/image:!plugin_path` — version-stripped identifier. */
  pluginKey: string;
  /** Tag (e.g. `1.2.3`) or digest (`sha256:...`). */
  version: string;
  /** True when tag was `{{inherit}}` (version to be resolved from an included config). */
  inherit: boolean;
  /**
   * Resolved plugin path — explicit `!<path>`, auto-detected from the image's
   * `io.backstage.dynamic-packages` annotation, or `null` when `{{inherit}}`
   * is used without a path (the merger resolves it later).
   */
  resolvedPath: string | null;
};

/**
 * Parse an `oci://...` package spec. Matches fast.py and the original
 * `OciPackageMerger.parse_plugin_key`. Calls into `imageCache.getPluginPaths`
 * to auto-detect single-plugin images when the `!path` suffix is omitted.
 */
export async function ociPluginKey(pkg: string, imageCache?: OciImageCache): Promise<ParsedOciKey> {
  const m = OCI_REGEX.exec(pkg);
  if (!m) {
    throw new InstallException(
      `oci package '${pkg}' is not in the expected format '${OCI_PROTO}<registry>:<tag>' ` +
        `or '${OCI_PROTO}<registry>@<algo>:<digest>' (optionally followed by '!<path>') ` +
        `where <registry> may include a port (e.g. host:5000/path) ` +
        `and <algo> is one of ${RECOGNIZED_ALGORITHMS.join(', ')}`,
    );
  }

  const registry = m[1] as string;
  const tag = m[2];
  const digest = m[3];
  let path = m[4] ?? null;

  const version = (tag ?? digest) as string;
  const inherit = tag === '{{inherit}}' && digest === undefined;

  if (inherit && !path) {
    // The merger will match against an earlier included plugin from the same image.
    return { pluginKey: registry, version, inherit, resolvedPath: null };
  }

  if (!path) {
    if (!imageCache) {
      throw new InstallException(
        `Cannot auto-detect plugin path for ${pkg}: no image cache provided`,
      );
    }
    const fullImage = tag ? `${registry}:${version}` : `${registry}@${version}`;
    log(`\n======= No plugin path specified for ${fullImage}, auto-detecting from OCI manifest`);
    const paths = await imageCache.getPluginPaths(fullImage);
    if (paths.length === 0) {
      throw new InstallException(
        `No plugins found in OCI image ${fullImage}. ` +
          `The image might not contain the 'io.backstage.dynamic-packages' annotation. ` +
          `Please ensure it was packaged using the @red-hat-developer-hub/cli plugin package command.`,
      );
    }
    if (paths.length > 1) {
      const formatted = paths.map(p => `  - ${p}`).join('\n');
      throw new InstallException(
        `Multiple plugins found in OCI image ${fullImage}:\n${formatted}\n` +
          `Please specify which plugin to install using the syntax: ${fullImage}!<plugin-name>`,
      );
    }
    path = paths[0] as string;
    log(`\n======= Auto-resolving OCI package ${fullImage} to use plugin path: ${path}`);
  }

  return {
    pluginKey: `${registry}:!${path}`,
    version,
    inherit,
    resolvedPath: path,
  };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
