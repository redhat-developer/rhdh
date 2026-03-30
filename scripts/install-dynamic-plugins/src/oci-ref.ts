/**
 * Parse oci:// references for Registry HTTP API
 */
const OCI_PREFIX = 'oci://';
const RE = new RegExp(
  '^(' +
    OCI_PREFIX +
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

export interface OciParsedRef {
  registry: string;
  repository: string;
  reference: string;
  kind: 'tag' | 'digest';
  pluginPath: string | null;
  fullImage: string;
  registryWithPrefix: string;
}

export function parseOciRef(ref: string): OciParsedRef {
  const m = ref.match(RE);
  if (!m) {
    throw new Error(`invalid OCI reference: ${ref}`);
  }
  const registryWithPrefix = m[1]!;
  const tag = m[2];
  const digest = m[3];
  const version = tag || digest;
  const path = m[4];
  const withoutProto = registryWithPrefix.replace(/^oci:\/\//, '');
  const slash = withoutProto.indexOf('/');
  if (slash < 0) {
    throw new Error(`invalid OCI reference (no repository path): ${ref}`);
  }
  const registry = withoutProto.slice(0, slash);
  const repository = withoutProto.slice(slash + 1);
  const fullImage = tag
    ? `${registryWithPrefix}:${version}`
    : `${registryWithPrefix}@${version}`;
  return {
    registry,
    repository,
    reference: version!,
    kind: tag ? 'tag' : 'digest',
    pluginPath: path || null,
    fullImage,
    registryWithPrefix
  };
}
