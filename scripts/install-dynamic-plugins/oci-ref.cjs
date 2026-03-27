#!/usr/bin/env node
/**
 * Parse oci:// references for Registry HTTP API
 */
'use strict';

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

function parse(ref) {
  const m = ref.match(RE);
  if (!m) {
    throw new Error(`invalid OCI reference: ${ref}`);
  }
  const registryWithPrefix = m[1];
  const tag = m[2];
  const digest = m[3];
  const version = tag || digest;
  const path = m[4];
  const withoutProto = registryWithPrefix.replace(/^oci:\/\//, '');
  const slash = withoutProto.indexOf('/');
  if (slash < 0) throw new Error(`invalid OCI reference (no repository path): ${ref}`);
  const registry = withoutProto.slice(0, slash);
  const repository = withoutProto.slice(slash + 1);
  const fullImage = tag ? `${registryWithPrefix}:${version}` : `${registryWithPrefix}@${version}`;
  return {
    registry,
    repository,
    reference: version,
    kind: tag ? 'tag' : 'digest',
    pluginPath: path || null,
    fullImage,
    registryWithPrefix
  };
}

const cmd = process.argv[2];
if (cmd === 'parse') {
  try {
    console.log(JSON.stringify(parse(process.argv[3])));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else {
  console.error('usage: oci-ref.cjs parse <oci://...>');
  process.exit(2);
}
