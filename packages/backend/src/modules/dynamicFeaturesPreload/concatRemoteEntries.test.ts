import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assembleConcatRemoteEntries,
  hashConcatBody,
} from './concatRemoteEntries';
import { createPreloadStore, type PreloadStore } from './store';

function snap(
  overrides: Partial<PreloadStore['moduleInfo'][string]> & {
    remoteEntry: string;
    globalName: string;
    publicPath?: string;
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
    publicPath: overrides.publicPath ?? 'http://localhost:7007/remotes/x/',
    ...overrides,
  } as unknown as PreloadStore['moduleInfo'][string];
}

describe('assembleConcatRemoteEntries', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rhdh-concat-remote-entries-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the store has no remotes', () => {
    expect(assembleConcatRemoteEntries(createPreloadStore())).toBeUndefined();
  });

  it('concatenates classic remoteEntry bodies with currentScript wrappers', () => {
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
      publicPath: 'http://localhost:7007/remotes/a/',
    });
    store.moduleInfo.remote_b = snap({
      remoteEntry: 'otherEntry.js',
      globalName: 'remote_b',
      remoteEntryType: 'var',
      publicPath: 'http://localhost:7007/remotes/b/',
    });

    const artifact = assembleConcatRemoteEntries(store);
    expect(artifact).toBeDefined();
    expect(artifact!.included).toEqual(['plugin-a', 'plugin-b']);
    expect(artifact!.skipped).toEqual([]);
    expect(artifact!.body).toContain(entryA);
    expect(artifact!.body).toContain(entryB);
    expect(artifact!.body).toContain('globalName=remote_a');
    expect(artifact!.body).toContain(
      'Object.defineProperty(document, "currentScript"',
    );
    expect(artifact!.body).toContain(
      'src: "http://localhost:7007/remotes/a/remoteEntry.js"',
    );
    expect(artifact!.body).toContain(
      'src: "http://localhost:7007/remotes/b/otherEntry.js"',
    );
    // Body must stay at script top level so `var globalName` becomes a
    // window binding (webpack library.type "var").
    expect(artifact!.body).toMatch(
      /}\)\(\);\nwindow\.remote_a = \{ get\(\) \{\}, init\(\) \{\} \};/,
    );
    expect(artifact!.hash).toBe(hashConcatBody(artifact!.body));
    expect(artifact!.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps library-type var declarations at top level (not function-scoped)', () => {
    // Real webpack MF remotes emit `var <globalName>;(()=>{…})()` — nesting
    // that in a function would leave window[globalName] unset.
    writeFileSync(
      join(dir, 'remoteEntry.js'),
      'var remote_var_lib;remote_var_lib={get(){},init(){}};',
    );

    const store = createPreloadStore();
    store.remotes.push({
      packageName: 'plugin-var',
      remoteInfo: { name: 'remote_var_lib', entry: 'http://x/v' },
      exposedModules: ['.'],
    });
    store.remoteAssetsPaths['plugin-var'] = dir;
    store.moduleInfo.remote_var_lib = snap({
      remoteEntry: 'remoteEntry.js',
      globalName: 'remote_var_lib',
      remoteEntryType: 'global',
    });

    const artifact = assembleConcatRemoteEntries(store)!;
    expect(artifact.body).toContain(
      'var remote_var_lib;remote_var_lib={get(){},init(){}};',
    );
    // Must NOT wrap the body in try { … } inside a function.
    expect(artifact.body).not.toMatch(/try \{\s*var remote_var_lib/);
    expect(artifact.body).toMatch(
      /}\)\(\);\nvar remote_var_lib;remote_var_lib=\{get\(\)\{\},init\(\)\{\}\};/,
    );
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

    const artifact = assembleConcatRemoteEntries(store);
    expect(artifact!.included).toEqual(['classic']);
    expect(artifact!.skipped.map(s => s.packageName).sort()).toEqual([
      'esm',
      'missing-file',
    ]);
    expect(artifact!.body).toContain('window.classic');
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

    expect(assembleConcatRemoteEntries(store)).toBeUndefined();
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
    expect(assembleConcatRemoteEntries(absStore)).toBeUndefined();

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
    expect(assembleConcatRemoteEntries(linkStore)).toBeUndefined();
  });

  it('inserts a leading semicolon between classic remote bodies (ASI safety)', () => {
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

    const artifact = assembleConcatRemoteEntries(store)!;
    // Setup + teardown IIFEs each start with `;(function` — ASI-safe
    // relative to the previous chunk even when that chunk omits a trailing
    // semicolon (2 remotes × 2 IIFEs).
    expect(artifact.body.match(/;\(function\(/g)).toHaveLength(4);
  });
});
