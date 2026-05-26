import type { OciImageCache } from '../src/image-cache';
import { ociPluginKey } from '../src/oci-key';

type SuccessCase = {
  pkg: string;
  key: string;
  version: string;
  inherit: boolean;
  path: string | null;
};

const successCases: SuccessCase[] = [
  // Tag-based packages with explicit path
  {
    pkg: 'oci://quay.io/user/plugin:v1.0!plugin-name',
    key: 'oci://quay.io/user/plugin:!plugin-name',
    version: 'v1.0',
    inherit: false,
    path: 'plugin-name',
  },
  {
    pkg: 'oci://registry.io/plugin:latest!path/to/plugin',
    key: 'oci://registry.io/plugin:!path/to/plugin',
    version: 'latest',
    inherit: false,
    path: 'path/to/plugin',
  },
  {
    pkg: 'oci://ghcr.io/org/plugin:1.2.3!my-plugin',
    key: 'oci://ghcr.io/org/plugin:!my-plugin',
    version: '1.2.3',
    inherit: false,
    path: 'my-plugin',
  },
  {
    pkg: 'oci://docker.io/library/plugin:v2.0.0!plugin',
    key: 'oci://docker.io/library/plugin:!plugin',
    version: 'v2.0.0',
    inherit: false,
    path: 'plugin',
  },

  // Digests with supported algorithms
  {
    pkg: 'oci://quay.io/user/plugin@sha256:abc123def456!plugin',
    key: 'oci://quay.io/user/plugin:!plugin',
    version: 'sha256:abc123def456',
    inherit: false,
    path: 'plugin',
  },
  {
    pkg: 'oci://registry.io/plugin@sha512:fedcba987654!plugin',
    key: 'oci://registry.io/plugin:!plugin',
    version: 'sha512:fedcba987654',
    inherit: false,
    path: 'plugin',
  },
  {
    pkg: 'oci://example.com/plugin@blake3:1234567890abcdef!my-plugin',
    key: 'oci://example.com/plugin:!my-plugin',
    version: 'blake3:1234567890abcdef',
    inherit: false,
    path: 'my-plugin',
  },

  // Inherit
  {
    pkg: 'oci://quay.io/user/plugin:{{inherit}}!plugin',
    key: 'oci://quay.io/user/plugin:!plugin',
    version: '{{inherit}}',
    inherit: true,
    path: 'plugin',
  },
  {
    pkg: 'oci://registry.io/plugin:{{inherit}}!path/to/plugin',
    key: 'oci://registry.io/plugin:!path/to/plugin',
    version: '{{inherit}}',
    inherit: true,
    path: 'path/to/plugin',
  },

  // Host:port registries
  {
    pkg: 'oci://registry.localhost:5000/rhdh-plugins/plugin:v1.0!plugin-name',
    key: 'oci://registry.localhost:5000/rhdh-plugins/plugin:!plugin-name',
    version: 'v1.0',
    inherit: false,
    path: 'plugin-name',
  },
  {
    pkg: 'oci://registry.localhost:5000/path@sha256:abc123!plugin',
    key: 'oci://registry.localhost:5000/path:!plugin',
    version: 'sha256:abc123',
    inherit: false,
    path: 'plugin',
  },
  {
    pkg: 'oci://registry.localhost:5000/path:{{inherit}}!plugin',
    key: 'oci://registry.localhost:5000/path:!plugin',
    version: '{{inherit}}',
    inherit: true,
    path: 'plugin',
  },
  {
    pkg: 'oci://10.0.0.1:5000/repo/plugin:tag!plugin',
    key: 'oci://10.0.0.1:5000/repo/plugin:!plugin',
    version: 'tag',
    inherit: false,
    path: 'plugin',
  },
];

const invalidCases: string[] = [
  // Missing tag/digest
  'oci://registry.io/plugin!path',
  'oci://registry.io/plugin',
  'oci://host:1000/path',
  // No tag/digest before !
  'oci://registry.io!path',
  'oci://host:1000!path',
  // Unsupported digest algorithm
  'oci://registry.io/plugin@md5:abc123!plugin',
  'oci://host:1000/path@md5:abc123!plugin',
  // Multiple @
  'oci://registry.io/plugin@@sha256:abc!plugin',
  'oci://host:1000/path@@sha256:abc!plugin',
  // Multiple : in tag
  'oci://registry.io/plugin:v1:v2!plugin',
  'oci://host:1000/path:v1:v2!plugin',
  // Empty tag
  'oci://registry.io/plugin:!plugin',
  'oci://registry.io/plugin:',
  'oci://host:1000/path:!plugin',
  'oci://host:1000/path:',
  // Empty path after !
  'oci://registry.io/plugin:v1.0!',
  'oci://host:1000/path:v1.0!',
  // No oci:// prefix
  'registry.io/plugin:v1.0!plugin',
  'registry.io/plugin:v1.0',
  'host:1000/path:v1.0!plugin',
  'host:1000/path:v1.0',
];

describe('ociPluginKey — success cases', () => {
  it.each(successCases)('parses $pkg', async ({ pkg, key, version, inherit, path }) => {
    const parsed = await ociPluginKey(pkg);
    expect(parsed.pluginKey).toBe(key);
    expect(parsed.version).toBe(version);
    expect(parsed.inherit).toBe(inherit);
    expect(parsed.resolvedPath).toBe(path);
  });
});

describe('ociPluginKey — invalid cases', () => {
  it.each(invalidCases)('rejects %s', async pkg => {
    await expect(ociPluginKey(pkg)).rejects.toThrow(/not in the expected format/);
  });
});

describe('ociPluginKey — {{inherit}} without path', () => {
  it('returns registry-only key and null path', async () => {
    const parsed = await ociPluginKey('oci://registry.io/plugin:{{inherit}}');
    expect(parsed.pluginKey).toBe('oci://registry.io/plugin');
    expect(parsed.version).toBe('{{inherit}}');
    expect(parsed.inherit).toBe(true);
    expect(parsed.resolvedPath).toBeNull();
  });
});

describe('ociPluginKey — auto-detect from image cache', () => {
  function fakeImageCache(paths: string[]): OciImageCache {
    return { getPluginPaths: async () => paths } as unknown as OciImageCache;
  }

  it('resolves a single plugin path', async () => {
    const parsed = await ociPluginKey(
      'oci://registry.io/plugin:v1.0',
      fakeImageCache(['auto-detected-plugin']),
    );
    expect(parsed.pluginKey).toBe('oci://registry.io/plugin:!auto-detected-plugin');
    expect(parsed.version).toBe('v1.0');
    expect(parsed.resolvedPath).toBe('auto-detected-plugin');
  });

  it('errors when no plugins are declared', async () => {
    await expect(ociPluginKey('oci://registry.io/plugin:v1.0', fakeImageCache([]))).rejects.toThrow(
      /No plugins found/,
    );
  });

  it('errors with list when multiple plugins are declared', async () => {
    await expect(
      ociPluginKey('oci://registry.io/plugin:v1.0', fakeImageCache(['p1', 'p2', 'p3'])),
    ).rejects.toThrow(/Multiple plugins found[\s\S]+p1[\s\S]+p2[\s\S]+p3/);
  });
});
