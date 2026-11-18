import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleFeaturesBootstrap, hashFeaturesBody } from './bootstrap';
import { createPreloadStore, type PreloadStore } from './store';

function snap(
  overrides: Partial<PreloadStore['moduleInfo'][string]> & {
    remoteEntry: string;
    globalName: string;
    remoteEntryType?: string;
  },
): PreloadStore['moduleInfo'][string] {
  return {
    name: overrides.globalName,
    version: 'v',
    buildVersion: '0.0.0',
    remotesInfo: [],
    shared: [],
    modules: [],
    publicPath: 'http://localhost:7007/remotes/x/',
    ...overrides,
  } as unknown as PreloadStore['moduleInfo'][string];
}

describe('assembleFeaturesBootstrap', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rhdh-features-bootstrap-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the store has no remotes', () => {
    expect(assembleFeaturesBootstrap(createPreloadStore())).toBeUndefined();
  });

  it('concatenates classic remoteEntry bodies and content-hashes them', () => {
    const entryA = 'window.remote_a = { get() {}, init() {} };';
    const entryB = 'window.remote_b = { get() {}, init() {} };';
    writeFileSync(join(dir, 'remoteEntry.js'), entryA);
    writeFileSync(join(dir, 'otherEntry.js'), entryB);

    const store = createPreloadStore();
    store.remotes.push(
      {
        packageName: 'plugin-a',
        remoteInfo: { name: 'remote_a', entry: 'http://x/a' },
        exposedModules: ['.'],
      },
      {
        packageName: 'plugin-b',
        remoteInfo: { name: 'remote_b', entry: 'http://x/b' },
        exposedModules: ['.'],
      },
    );
    store.remoteAssetsPaths['plugin-a'] = dir;
    store.remoteAssetsPaths['plugin-b'] = dir;
    store.moduleInfo.remote_a = snap({
      remoteEntry: 'remoteEntry.js',
      globalName: 'remote_a',
      remoteEntryType: 'global',
    });
    store.moduleInfo.remote_b = snap({
      remoteEntry: 'otherEntry.js',
      globalName: 'remote_b',
      remoteEntryType: 'var',
    });

    const artifact = assembleFeaturesBootstrap(store);
    expect(artifact).toBeDefined();
    expect(artifact!.included).toEqual(['plugin-a', 'plugin-b']);
    expect(artifact!.skipped).toEqual([]);
    expect(artifact!.body).toContain(entryA);
    expect(artifact!.body).toContain(entryB);
    expect(artifact!.body).toContain('globalName=remote_a');
    expect(artifact!.hash).toBe(hashFeaturesBody(artifact!.body));
    expect(artifact!.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('skips ESM remotes and missing files', () => {
    writeFileSync(
      join(dir, 'remoteEntry.js'),
      'window.classic = { get() {}, init() {} };',
    );

    const store = createPreloadStore();
    store.remotes.push(
      {
        packageName: 'classic',
        remoteInfo: { name: 'classic', entry: 'http://x/c' },
        exposedModules: ['.'],
      },
      {
        packageName: 'esm',
        remoteInfo: { name: 'esm', entry: 'http://x/e' },
        exposedModules: ['.'],
      },
      {
        packageName: 'missing-file',
        remoteInfo: { name: 'missing', entry: 'http://x/m' },
        exposedModules: ['.'],
      },
    );
    store.remoteAssetsPaths.classic = dir;
    store.remoteAssetsPaths.esm = dir;
    store.remoteAssetsPaths['missing-file'] = dir;
    store.moduleInfo.classic = snap({
      remoteEntry: 'remoteEntry.js',
      globalName: 'classic',
      remoteEntryType: 'global',
    });
    store.moduleInfo.esm = snap({
      remoteEntry: 'remoteEntry.js',
      globalName: 'esm',
      remoteEntryType: 'module',
    });
    store.moduleInfo.missing = snap({
      remoteEntry: 'does-not-exist.js',
      globalName: 'missing',
      remoteEntryType: 'global',
    });

    const artifact = assembleFeaturesBootstrap(store);
    expect(artifact!.included).toEqual(['classic']);
    expect(artifact!.skipped.map(s => s.packageName).sort()).toEqual([
      'esm',
      'missing-file',
    ]);
    expect(artifact!.body).toContain('window.classic');
    expect(artifact!.body).not.toContain('packageName: esm');
  });

  it('rejects path traversal in remoteEntry names', () => {
    const store = createPreloadStore();
    store.remotes.push({
      packageName: 'evil',
      remoteInfo: { name: 'evil', entry: 'http://x/e' },
      exposedModules: ['.'],
    });
    store.remoteAssetsPaths.evil = dir;
    store.moduleInfo.evil = snap({
      remoteEntry: '../outside.js',
      globalName: 'evil',
      remoteEntryType: 'global',
    });

    expect(assembleFeaturesBootstrap(store)).toBeUndefined();
  });

  it('rejects absolute remoteEntry paths and symlink escapes', () => {
    const outside = join(dir, 'outside-secret.js');
    writeFileSync(outside, 'window.LEAKED = 1;');
    const assets = mkdtempSync(join(dir, 'assets-'));
    symlinkSync(outside, join(assets, 'remoteEntry.js'));

    const absStore = createPreloadStore();
    absStore.remotes.push({
      packageName: 'abs',
      remoteInfo: { name: 'abs', entry: 'http://x/a' },
      exposedModules: ['.'],
    });
    absStore.remoteAssetsPaths.abs = assets;
    absStore.moduleInfo.abs = snap({
      remoteEntry: outside,
      globalName: 'abs',
      remoteEntryType: 'global',
    });
    expect(assembleFeaturesBootstrap(absStore)).toBeUndefined();

    const linkStore = createPreloadStore();
    linkStore.remotes.push({
      packageName: 'link',
      remoteInfo: { name: 'link', entry: 'http://x/l' },
      exposedModules: ['.'],
    });
    linkStore.remoteAssetsPaths.link = assets;
    linkStore.moduleInfo.link = snap({
      remoteEntry: 'remoteEntry.js',
      globalName: 'link',
      remoteEntryType: 'global',
    });
    expect(assembleFeaturesBootstrap(linkStore)).toBeUndefined();
  });

  it('inserts a leading semicolon between classic remote bodies (ASI safety)', () => {
    // First chunk ends without semicolon; second starts with `(` — without a
    // separator the two would parse as a call expression.
    writeFileSync(
      join(dir, 'a.js'),
      'window.remote_a = { get() {}, init() {} }',
    );
    writeFileSync(join(dir, 'b.js'), '(function(){ window.remote_b = 1 })()');

    const store = createPreloadStore();
    store.remotes.push(
      {
        packageName: 'plugin-a',
        remoteInfo: { name: 'remote_a', entry: 'http://x/a' },
        exposedModules: ['.'],
      },
      {
        packageName: 'plugin-b',
        remoteInfo: { name: 'remote_b', entry: 'http://x/b' },
        exposedModules: ['.'],
      },
    );
    store.remoteAssetsPaths['plugin-a'] = dir;
    store.remoteAssetsPaths['plugin-b'] = dir;
    store.moduleInfo.remote_a = snap({
      remoteEntry: 'a.js',
      globalName: 'remote_a',
      remoteEntryType: 'global',
    });
    store.moduleInfo.remote_b = snap({
      remoteEntry: 'b.js',
      globalName: 'remote_b',
      remoteEntryType: 'global',
    });

    const artifact = assembleFeaturesBootstrap(store)!;
    expect(artifact.body).toMatch(
      /globalName=remote_a\) --- \*\/\n;window\.remote_a/,
    );
    expect(artifact.body).toMatch(
      /globalName=remote_b\) --- \*\/\n;\(function/,
    );
  });
});
