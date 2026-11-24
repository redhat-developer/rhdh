import {
  CommonJSModuleLoader,
  dynamicPluginsFeatureLoader,
} from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createBackendPlugin,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { hashedRemoteEntriesMiddleware } from '../../middleware/hashedRemoteEntries';
import { dynamicFeaturesResolver } from '../dynamicFeaturesResolver';
import {
  DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
  DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH,
} from './paths';
import { hashedRemoteEntryName } from './remoteEntryHash';
import { remoteEntryRegistry } from './remoteEntryRegistry';

jest.setTimeout(60_000);

/**
 * Thin wiring smoke: proves the plugin is registered with the upstream
 * dynamic-features service, NFS filtering is applied on /remotes, and the
 * collected store is served from preload.js.
 *
 * Filter logic, collector, and handler are covered by unit tests — do not
 * re-assert those details here.
 */

async function testModuleLoader(logger: LoggerService) {
  const loader = new CommonJSModuleLoader({ logger });
  (loader as any).module = await loader.load('node:module');
  loader.bootstrap = async () => {};
  return loader;
}

const dynamicPluginsRootDirectory = resolvePath(
  __dirname,
  '../__fixtures__/dynamic-plugins-root-for-nfs-filter',
);

/**
 * Mounts the hashed remote entries middleware for the test backend.
 *
 * The production wiring lives in RHDH's defaultServiceFactories (a global
 * middleware before applyDefaults()), which startTestBackend does not use;
 * the test backend's root router only accepts path-prefixed mounts. The
 * prefix is arbitrary: the middleware matches the full remotes path from
 * req.path, which Express keeps after stripping the mount prefix.
 */
const hashedEntriesTestMount = createBackendPlugin({
  pluginId: 'hashed-entries-test-mount',
  register(reg) {
    reg.registerInit({
      deps: { rootHttpRouter: coreServices.rootHttpRouter },
      async init({ rootHttpRouter }) {
        rootHttpRouter.use(
          '/hashed-entries-test',
          hashedRemoteEntriesMiddleware(),
        );
      },
    });
  },
});

describe('dynamicFeaturesResolver wiring', () => {
  let port: number;

  beforeAll(async () => {
    const backend = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: {
            dynamicPlugins: {
              rootDirectory: dynamicPluginsRootDirectory,
            },
            backend: {
              baseUrl: 'http://localhost:0',
            },
          },
        }),
        dynamicPluginsFeatureLoader({
          moduleLoader: logger => testModuleLoader(logger),
        }),
        dynamicFeaturesResolver,
        hashedEntriesTestMount,
      ],
    });
    port = backend.server.port();
  });

  it('wires NFS filtering into GET /remotes', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}`,
    );
    expect(res.ok).toBe(true);
    const remotes = await res.json();

    const mixed = remotes.find(
      (r: { packageName: string }) =>
        r.packageName === 'plugin-test-mixed-features-dynamic',
    );
    expect(mixed?.exposedModules).toEqual(['alpha']);

    const noFeatures = remotes.find(
      (r: { packageName: string }) =>
        r.packageName === 'plugin-test-no-features-dynamic',
    );
    expect(noFeatures?.exposedModules).toEqual(['.', 'alpha']);
  });

  it('serves preload.js whose remotes match /remotes filtering', async () => {
    const [remotesRes, preloadRes] = await Promise.all([
      fetch(`http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}`),
      fetch(`http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`),
    ]);

    expect(preloadRes.ok).toBe(true);
    expect(preloadRes.headers.get('content-type')).toContain(
      'application/javascript',
    );

    const remotes = await remotesRes.json();
    const body = await preloadRes.text();

    expect(body).toContain('window.__FEDERATION__.moduleInfo');

    // Parse the local `var remotes = [...]` inside the IIFE
    const remotesMatch = body.match(/var remotes = (\[.+?\]);/s);
    expect(remotesMatch).not.toBeNull();
    const preloaded = JSON.parse(remotesMatch![1]);

    expect(preloaded).toHaveLength(remotes.length);
    for (const remote of remotes) {
      const match = preloaded.find(
        (r: { packageName: string }) => r.packageName === remote.packageName,
      );
      expect(match?.exposedModules).toEqual(remote.exposedModules);
      expect(match?.remoteInfo.name).toBe(remote.remoteInfo.name);
    }
  });

  it('serves shared assets in-place from a plugin dist/shared directory', async () => {
    const runtimeName =
      'webpack-bundler-runtime@test-rspack-test-0123abcd4567ef89.mjs';
    const url = `http://127.0.0.1:${port}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/${runtimeName}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    await expect(res.text()).resolves.toContain('test shared runtime entry');
    // The fixture name's trailing segment is not the sha256 prefix of
    // its bytes — a name that merely looks hashed stays on
    // revalidation caching.
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
  });

  it('serves verified content-addressed shared assets immutable', async () => {
    // Fixture whose file name ends with the sha256 prefix of its own
    // bytes — verified at registration, so the URL can never be reused
    // for different content without failing that check.
    const assetName = 'fixture-module@1.0.0-5c73ca0807811c5a.js';
    const url = `http://127.0.0.1:${port}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/${assetName}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(
      'content-addressed-shared-asset',
    );
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('serves non-module shared assets without modulepreloading them', async () => {
    const url = `http://127.0.0.1:${port}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/test-asset.txt`;
    const res = await fetch(url);

    // Any file type under dist/shared/ is served...
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(
      'not an ES module, served but never modulepreloaded',
    );

    // ...but only .mjs files join the preload list.
    const preloadRes = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`,
    );
    expect(preloadRes.ok).toBe(true);
    const body = await preloadRes.text();
    expect(body).not.toContain('test-asset.txt');
  });

  it('modulepreloads the canonical shared .mjs URL in preload.js', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`,
    );
    expect(res.ok).toBe(true);

    const body = await res.text();
    // The canonical URL (backend baseUrl-anchored) is what ESM remote
    // entries' baked relative runtime external resolves to —
    // modulepreloaded to warm exactly that fetch.
    expect(body).toContain(
      `var sharedModules = ["http://localhost:0${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/webpack-bundler-runtime@test-rspack-test-0123abcd4567ef89.mjs"]`,
    );
    expect(body).toContain('bl.rel = "modulepreload"');
  });

  it('does not serve unrecognized filenames from the shared assets route', async () => {
    const url = `http://127.0.0.1:${port}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/package.json`;
    const res = await fetch(url);

    expect(res.status).toBe(404);
  });

  it('serves the manifest with the content-hashed remoteEntry name', async () => {
    const entryBytes = readFileSync(
      resolvePath(
        dynamicPluginsRootDirectory,
        'test-mixed-features-dynamic/dist/remoteEntry.js',
      ),
    );
    const expectedName = hashedRemoteEntryName(entryBytes);

    // The manifest URL is served in-memory by the upstream router via
    // the resolver's customizeManifest hook.
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/mf-manifest.json`,
    );
    expect(res.ok).toBe(true);
    const manifest = await res.json();
    expect(manifest.metaData.remoteEntry.name).toBe(expectedName);
    // path must remain "" and type preserved (remoteEntryType derives
    // from it)
    expect(manifest.metaData.remoteEntry.path).toBe('');
    expect(manifest.metaData.remoteEntry.type).toBe('global');
  });

  it('serves the hashed remote entry immutable with the registered bytes', async () => {
    const entryBytes = readFileSync(
      resolvePath(
        dynamicPluginsRootDirectory,
        'test-mixed-features-dynamic/dist/remoteEntry.js',
      ),
    );
    const hashedName = hashedRemoteEntryName(entryBytes);

    const res = await fetch(
      `http://127.0.0.1:${port}/hashed-entries-test${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/${hashedName}`,
      { headers: { 'Accept-Encoding': 'identity' } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(entryBytes),
    );
  });

  it('404s a stale hash for a known plugin', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/hashed-entries-test${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/remoteEntry.0000000000000000.js`,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('still serves the literal remoteEntry.js with max-age=0 (fallback)', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/remoteEntry.js`,
    );
    expect(res.ok).toBe(true);
    // Upstream express.static default: the literal URL is content-stable
    // and must revalidate.
    expect(res.headers.get('cache-control')).toBe('public, max-age=0');
  });

  it('embeds the hashed entry href in preload.js', async () => {
    const entryBytes = readFileSync(
      resolvePath(
        dynamicPluginsRootDirectory,
        'test-mixed-features-dynamic/dist/remoteEntry.js',
      ),
    );
    const hashedName = hashedRemoteEntryName(entryBytes);

    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`,
    );
    expect(res.ok).toBe(true);
    const body = await res.text();

    // The snapshot embedded in preload.js carries the hashed name, so the
    // emitted entry href (publicPath + remoteEntry) is content-addressed.
    expect(body).toContain(`"remoteEntry":"${hashedName}"`);
    // And the remotes list still points at the manifest URL.
    expect(body).toContain(
      `${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/mf-manifest.json`,
    );
  });
});

describe('dynamicFeaturesResolver with core.rootHttpRouter overridden', () => {
  let port: number;
  const previousEnv = process.env.ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE;

  beforeAll(async () => {
    // When a dynamic plugin overrides core.rootHttpRouter (e.g.
    // adoption-insights), RHDH's default root-router factory — and with it
    // hashedRemoteEntriesMiddleware — is not installed. The resolver must
    // then not reference hashed entry names anywhere.
    process.env.ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE = 'true';
    remoteEntryRegistry.clear();

    const backend = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: {
            dynamicPlugins: {
              rootDirectory: dynamicPluginsRootDirectory,
            },
            backend: {
              baseUrl: 'http://localhost:0',
            },
          },
        }),
        dynamicPluginsFeatureLoader({
          moduleLoader: logger => testModuleLoader(logger),
        }),
        dynamicFeaturesResolver,
        hashedEntriesTestMount,
      ],
    });
    port = backend.server.port();
  });

  afterAll(() => {
    if (previousEnv === undefined) {
      delete process.env.ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE;
    } else {
      process.env.ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE = previousEnv;
    }
  });

  it('keeps the literal remoteEntry.js name in the served manifest', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/mf-manifest.json`,
    );
    expect(res.ok).toBe(true);
    const manifest = await res.json();
    expect(manifest.metaData.remoteEntry.name).toBe('remoteEntry.js');
  });

  it('keeps the literal entry name in preload.js', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`,
    );
    expect(res.ok).toBe(true);
    const body = await res.text();
    expect(body).toContain(`"remoteEntry":"remoteEntry.js"`);
    expect(body).not.toMatch(/remoteEntry\.[0-9a-f]{16}\.js/);
  });

  it('registers no entries in the hashed-entry registry', async () => {
    const entryBytes = readFileSync(
      resolvePath(
        dynamicPluginsRootDirectory,
        'test-mixed-features-dynamic/dist/remoteEntry.js',
      ),
    );
    const hashedName = hashedRemoteEntryName(entryBytes);

    // Even if a hashed URL were requested, nothing serves it.
    const res = await fetch(
      `http://127.0.0.1:${port}/hashed-entries-test${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/${hashedName}`,
    );
    expect(res.status).toBe(404);
  });

  it('still serves the literal remoteEntry.js (upstream static)', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}/plugin-test-mixed-features-dynamic/remoteEntry.js`,
    );
    expect(res.ok).toBe(true);
  });
});

describe('dynamicFeaturesResolver shared asset conflicts', () => {
  const conflictRootDirectory = resolvePath(
    __dirname,
    '../__fixtures__/dynamic-plugins-root-for-shared-conflict',
  );
  const conflictPackages = [
    'plugin-test-conflict-alpha-dynamic',
    'plugin-test-conflict-beta-dynamic',
  ];

  it('drops the conflicting plugin and serves the surviving plugin copy', async () => {
    const backend = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: {
            dynamicPlugins: {
              rootDirectory: conflictRootDirectory,
            },
            backend: {
              baseUrl: 'http://localhost:0',
            },
          },
        }),
        dynamicPluginsFeatureLoader({
          moduleLoader: logger => testModuleLoader(logger),
        }),
        dynamicFeaturesResolver,
      ],
    });
    try {
      const port = backend.server.port();

      // The scan for the second-registered plugin throws inside the
      // upstream for() hook; upstream catches it and skips that entire
      // plugin from /remotes. Which plugin survives depends on scan
      // order, so assert order-independently: exactly one is exposed.
      const remotesRes = await fetch(
        `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}`,
      );
      expect(remotesRes.ok).toBe(true);
      const remotes = await remotesRes.json();
      const present = remotes.filter((r: { packageName: string }) =>
        conflictPackages.includes(r.packageName),
      );
      expect(present).toHaveLength(1);

      // The surviving provider's copy is served for the colliding name.
      const assetRes = await fetch(
        `http://127.0.0.1:${port}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/colliding.txt`,
      );
      expect(assetRes.status).toBe(200);
      const served = await assetRes.text();
      const survivor = present[0].packageName as string;
      expect(served).toContain(
        survivor === conflictPackages[0]
          ? 'from plugin alpha'
          : 'from plugin beta',
      );
    } finally {
      await backend.stop();
    }
  });
});
