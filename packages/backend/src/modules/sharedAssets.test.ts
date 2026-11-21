import type { LoggerService } from '@backstage/backend-plugin-api';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH } from './dynamicFeaturesPreload/paths';
import { createPreloadStore } from './dynamicFeaturesPreload/store';
import { registerSharedAssets } from './sharedAssets';
import type { SharedAssetRegistry } from './sharedAssets';

function canonicalUrl(file: string): string {
  return `${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/${file}`;
}

function createMockLogger(): LoggerService {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as LoggerService;
}

/** Create a fake plugin package with the given dist/shared files. */
function writePlugin(
  root: string,
  name: string,
  sharedFiles: Record<string, string>,
): string {
  const pluginDir = path.join(root, name);
  const sharedDir = path.join(pluginDir, 'dist', 'shared');
  fs.mkdirSync(sharedDir, { recursive: true });
  for (const [fileName, contents] of Object.entries(sharedFiles)) {
    fs.writeFileSync(path.join(sharedDir, fileName), contents);
  }
  return pluginDir;
}

function sha16(filePath: string): string {
  return createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .slice(0, 16);
}

function setup(): {
  root: string;
  registry: SharedAssetRegistry;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-assets-'));
  return { root, registry: new Map() };
}

describe('registerSharedAssets', () => {
  it('registers files and modulepreloads only .mjs files', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const logger = createMockLogger();
    const pluginDir = writePlugin(root, 'plugin-a', {
      'runtime.mjs': 'export default 1;',
      'asset.txt': 'not a module',
      'styles.css': 'body{}',
    });

    registerSharedAssets(registry, store, pluginDir, 'plugin-a', logger);

    expect([...registry.keys()].sort()).toEqual([
      'asset.txt',
      'runtime.mjs',
      'styles.css',
    ]);
    expect(registry.get('runtime.mjs')).toMatchObject({
      provider: 'plugin-a',
      content: Buffer.from('export default 1;'),
    });
    expect(store.sharedModuleUrls).toEqual([canonicalUrl('runtime.mjs')]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is a no-op for plugins without dist/shared', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const pluginDir = path.join(root, 'plugin-a');
    fs.mkdirSync(pluginDir, { recursive: true });

    registerSharedAssets(
      registry,
      store,
      pluginDir,
      'plugin-a',
      createMockLogger(),
    );

    expect(registry.size).toBe(0);
    expect(store.sharedModuleUrls).toEqual([]);
  });

  it('dedupes identical content with a single canonical URL', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const contents = 'export default 1;';
    const pluginA = writePlugin(root, 'plugin-a', { 'runtime.mjs': contents });
    const pluginB = writePlugin(root, 'plugin-b', { 'runtime.mjs': contents });

    registerSharedAssets(
      registry,
      store,
      pluginA,
      'plugin-a',
      createMockLogger(),
    );
    registerSharedAssets(
      registry,
      store,
      pluginB,
      'plugin-b',
      createMockLogger(),
    );

    // One served copy, first provider wins — and one canonical URL.
    expect(registry.size).toBe(1);
    expect(registry.get('runtime.mjs')).toMatchObject({ provider: 'plugin-a' });
    expect(store.sharedModuleUrls).toEqual([canonicalUrl('runtime.mjs')]);
  });

  it('throws on a content conflict before registering any of the plugin files', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const pluginA = writePlugin(root, 'plugin-a', {
      'runtime.mjs': 'export default 1;',
    });
    const pluginB = writePlugin(root, 'plugin-b', {
      'runtime.mjs': 'export default 2;',
      'extra.mjs': 'export default 3;',
    });

    registerSharedAssets(
      registry,
      store,
      pluginA,
      'plugin-a',
      createMockLogger(),
    );

    expect(() =>
      registerSharedAssets(
        registry,
        store,
        pluginB,
        'plugin-b',
        createMockLogger(),
      ),
    ).toThrow(
      new RegExp(
        [
          "Shared asset conflict: 'runtime\\.mjs' from plugin 'plugin-b'",
          `\\(sha256:${sha16(path.join(root, 'plugin-b', 'dist', 'shared', 'runtime.mjs'))}\\)`,
        ].join(' '),
      ),
    );

    // Two-pass atomicity: the conflicting plugin contributed no files,
    // not even the non-conflicting ones — and no canonical URL.
    expect([...registry.keys()]).toEqual(['runtime.mjs']);
    expect(registry.get('runtime.mjs')).toMatchObject({ provider: 'plugin-a' });
    expect(store.sharedModuleUrls).toEqual([canonicalUrl('runtime.mjs')]);
  });

  it('names both plugins and hashes in the conflict error', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const pluginA = writePlugin(root, 'plugin-a', {
      'colliding.txt': 'alpha bytes',
    });
    const pluginB = writePlugin(root, 'plugin-b', {
      'colliding.txt': 'beta bytes',
    });

    registerSharedAssets(
      registry,
      store,
      pluginA,
      'plugin-a',
      createMockLogger(),
    );

    expect(() =>
      registerSharedAssets(
        registry,
        store,
        pluginB,
        'plugin-b',
        createMockLogger(),
      ),
    ).toThrow(
      `Shared asset conflict: 'colliding.txt' from plugin 'plugin-b' (sha256:${sha16(
        path.join(root, 'plugin-b', 'dist', 'shared', 'colliding.txt'),
      )}) differs from the copy registered by plugin 'plugin-a' (sha256:${sha16(
        path.join(root, 'plugin-a', 'dist', 'shared', 'colliding.txt'),
      )}). Files under dist/shared must be content-identical across plugins.`,
    );
  });

  it('skips directory entries with a warning', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const pluginDir = path.join(root, 'plugin-a');
    const sharedDir = path.join(pluginDir, 'dist', 'shared');
    fs.mkdirSync(path.join(sharedDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'runtime.mjs'), 'export default 1;');

    const logger = createMockLogger();
    registerSharedAssets(registry, store, pluginDir, 'plugin-a', logger);

    expect([...registry.keys()]).toEqual(['runtime.mjs']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "ignoring 'shared/nested' of plugin-a: subdirectories are not served",
      ),
    );
  });

  it('marks verified content-addressed names immutable', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    const contents = 'export const marker = "content-addressed";\n';
    const hash16 = createHash('sha256')
      .update(contents)
      .digest('hex')
      .slice(0, 16);
    const pluginDir = writePlugin(root, 'plugin-a', {
      [`webpack-bundler-runtime@2.8.0-${hash16}.mjs`]: contents,
    });

    registerSharedAssets(
      registry,
      store,
      pluginDir,
      'plugin-a',
      createMockLogger(),
    );

    expect(
      registry.get(`webpack-bundler-runtime@2.8.0-${hash16}.mjs`),
    ).toMatchObject({ immutable: true });
  });

  it('does not mark names that merely look hashed as immutable', () => {
    const { root, registry } = setup();
    const store = createPreloadStore();
    // The trailing segment is 16 hex chars but not the sha256 prefix of
    // these bytes — a name cannot earn immutable caching without
    // matching its own content.
    const pluginDir = writePlugin(root, 'plugin-a', {
      'looks-hashed-0123abcd4567ef89.mjs': 'export default 1;',
      'plain-name.mjs': 'export default 2;',
    });

    registerSharedAssets(
      registry,
      store,
      pluginDir,
      'plugin-a',
      createMockLogger(),
    );

    expect(registry.get('looks-hashed-0123abcd4567ef89.mjs')).toMatchObject({
      immutable: false,
    });
    expect(registry.get('plain-name.mjs')).toMatchObject({
      immutable: false,
    });
  });
});
