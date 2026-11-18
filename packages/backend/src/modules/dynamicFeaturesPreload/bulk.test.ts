import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

import { assembleBulkRemoteEntries, hashBulkBody } from './bulk';
import { createPreloadStore, type PreloadStore } from './store';

const fixturesRoot = resolvePath(
  __dirname,
  '../__fixtures__/dynamic-plugins-root-for-nfs-filter',
);

function classicSnap(overrides: {
  publicPath: string;
  remoteEntry: string;
  name?: string;
  globalName?: string;
  remoteEntryType?: string;
  modules?: unknown[];
}): PreloadStore['moduleInfo'][string] {
  return {
    name: overrides.name ?? 'backstage__plugin_test',
    version: 'v',
    buildVersion: '0.0.0',
    remotesInfo: [],
    shared: [],
    modules: [],
    globalName: overrides.globalName ?? 'backstage__plugin_test',
    ...overrides,
  } as unknown as PreloadStore['moduleInfo'][string];
}

describe('assembleBulkRemoteEntries', () => {
  it('returns undefined when the store is empty', () => {
    expect(assembleBulkRemoteEntries(createPreloadStore())).toBeUndefined();
  });

  it('includes classic remoteEntry sources keyed by public URL', () => {
    const store = createPreloadStore();
    const packageName = 'plugin-test-mixed-features-dynamic';
    store.remotes.push({
      packageName,
      remoteInfo: {
        name: 'backstage__plugin_test_mixed_features',
        entry:
          'http://localhost:7007/.backstage/dynamic-features/remotes/x/mf-manifest.json',
      },
      exposedModules: ['alpha'],
    });
    store.remoteAssetsPaths[packageName] = resolvePath(
      fixturesRoot,
      'test-mixed-features-dynamic',
      'dist',
    );
    store.moduleInfo.backstage__plugin_test_mixed_features = classicSnap({
      name: 'backstage__plugin_test_mixed_features',
      globalName: 'backstage__plugin_test_mixed_features',
      publicPath:
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/',
      remoteEntry: 'remoteEntry.js',
      modules: [
        {
          moduleName: 'alpha',
          modulePath: './alpha',
          assets: {
            // Fixtures do not ship sync chunks on disk — assembler skips missing ones.
            js: { sync: ['static/missing.chunk.js'], async: [] },
            css: { sync: [], async: [] },
          },
        },
      ],
    });

    const artifact = assembleBulkRemoteEntries(store);
    expect(artifact).toBeDefined();
    if (!artifact) {
      throw new Error('expected bulk artifact');
    }

    const entryUrl =
      'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/remoteEntry.js';
    expect(artifact.payload.evaluate).toEqual([entryUrl]);
    expect(artifact.payload.sources[entryUrl]).toContain('doNothing');
    expect(artifact.includedRemoteEntries).toEqual([packageName]);
    expect(artifact.includedSyncChunkUrls).toEqual([]);
    expect(artifact.hash).toBe(hashBulkBody(artifact.body));
    expect(JSON.parse(artifact.body).version).toBe(1);
  });

  it('rejects path-traversal remoteEntry relative paths', () => {
    const tmp = resolvePath(
      tmpdir(),
      `rhdh-bulk-trav-${process.pid}-${Date.now()}`,
    );
    mkdirSync(tmp, { recursive: true });
    writeFileSync(resolvePath(tmp, 'remoteEntry.js'), 'ok\n');

    try {
      const store = createPreloadStore();
      store.remotes.push({
        packageName: 'plugin-trav',
        remoteInfo: {
          name: 'trav_remote',
          entry: 'http://localhost:7007/mf-manifest.json',
        },
        exposedModules: ['.'],
      });
      store.remoteAssetsPaths['plugin-trav'] = tmp;
      store.moduleInfo.trav_remote = classicSnap({
        name: 'trav_remote',
        globalName: 'trav_remote',
        publicPath: 'http://localhost:7007/remotes/trav/',
        remoteEntry: '../outside.js',
      });

      expect(assembleBulkRemoteEntries(store)).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips ESM remotes (module/esm remoteEntryType)', () => {
    const store = createPreloadStore();
    store.remotes.push({
      packageName: 'plugin-test-esm-dynamic',
      remoteInfo: {
        name: 'backstage__plugin_test_esm',
        entry: 'http://localhost:7007/mf-manifest.json',
      },
      exposedModules: ['.'],
    });
    store.remoteAssetsPaths['plugin-test-esm-dynamic'] = resolvePath(
      fixturesRoot,
      'test-mixed-features-dynamic',
      'dist',
    );
    store.moduleInfo.backstage__plugin_test_esm = classicSnap({
      name: 'backstage__plugin_test_esm',
      globalName: 'backstage__plugin_test_esm',
      publicPath: 'http://localhost:7007/remotes/esm/',
      remoteEntry: 'remoteEntry.js',
      remoteEntryType: 'module',
    });

    expect(assembleBulkRemoteEntries(store)).toBeUndefined();
  });

  it('includes expose sync JS chunks when present on disk', () => {
    const tmp = resolvePath(
      tmpdir(),
      `rhdh-bulk-test-${process.pid}-${Date.now()}`,
    );
    mkdirSync(resolvePath(tmp, 'static'), { recursive: true });
    writeFileSync(
      resolvePath(tmp, 'remoteEntry.js'),
      'window.bulk_test_remote = { get() {} };\n',
    );
    writeFileSync(
      resolvePath(tmp, 'static', '1000.sync.js'),
      'window.bulk_test_chunk = 1;\n',
    );

    try {
      const store = createPreloadStore();
      store.remotes.push({
        packageName: 'plugin-bulk-tmp',
        remoteInfo: {
          name: 'bulk_test_remote',
          entry: 'http://localhost:7007/mf-manifest.json',
        },
        exposedModules: ['alpha'],
      });
      store.remoteAssetsPaths['plugin-bulk-tmp'] = tmp;
      store.moduleInfo.bulk_test_remote = classicSnap({
        name: 'bulk_test_remote',
        globalName: 'bulk_test_remote',
        publicPath: 'http://localhost:7007/remotes/tmp/',
        remoteEntry: 'remoteEntry.js',
        modules: [
          {
            moduleName: 'alpha',
            modulePath: './alpha',
            assets: {
              js: { sync: ['static/1000.sync.js'], async: [] },
              css: { sync: [], async: [] },
            },
          },
        ],
      });

      const artifact = assembleBulkRemoteEntries(store);
      expect(artifact).toBeDefined();
      if (!artifact) {
        throw new Error('expected bulk artifact');
      }

      const entryUrl = 'http://localhost:7007/remotes/tmp/remoteEntry.js';
      const chunkUrl = 'http://localhost:7007/remotes/tmp/static/1000.sync.js';
      expect(artifact.payload.evaluate).toEqual([entryUrl]);
      expect(artifact.payload.sources[entryUrl]).toContain('bulk_test_remote');
      expect(artifact.payload.sources[chunkUrl]).toContain('bulk_test_chunk');
      expect(artifact.includedSyncChunkUrls).toEqual([chunkUrl]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
