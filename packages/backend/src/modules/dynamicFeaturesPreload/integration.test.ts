import {
  CommonJSModuleLoader,
  dynamicPluginsFeatureLoader,
} from '@backstage/backend-dynamic-feature-service';
import { LoggerService } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

import { resolve as resolvePath } from 'node:path';

import { dynamicFeaturesResolver } from '../dynamicFeaturesResolver';
import { hashFeaturesBody } from './bootstrap';
import {
  DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH,
  DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
  DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH,
  featuresBootstrapHashedPath,
} from './paths';

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

  it('serves features bootstrap with classic remoteEntries and disables mass JS preloads', async () => {
    const [preloadRes, featuresRes] = await Promise.all([
      fetch(`http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`),
      fetch(
        `http://127.0.0.1:${port}${DYNAMIC_FEATURES_BOOTSTRAP_SCRIPT_PATH}`,
      ),
    ]);

    expect(preloadRes.ok).toBe(true);
    expect(featuresRes.ok).toBe(true);

    const preloadBody = await preloadRes.text();
    const featuresBody = await featuresRes.text();

    expect(preloadBody).toContain('"enabled":true');
    // Mass classic remoteEntry/sync script preloads are off when bootstrap is active
    expect(preloadBody).not.toContain('l.as = "script"');

    // Fixture remoteEntries are no-op IIFEs; they must still appear in the bundle
    expect(featuresBody).toContain('RHDH dynamic-features bootstrap');
    expect(featuresBody).toContain('(function doNothing(){})();');
    expect(featuresBody).toContain('plugin-test-mixed-features-dynamic');

    const hash = hashFeaturesBody(featuresBody);
    expect(featuresRes.headers.get('etag')).toBe(`"${hash}"`);

    const hashedRes = await fetch(
      `http://127.0.0.1:${port}${featuresBootstrapHashedPath(hash)}`,
    );
    expect(hashedRes.status).toBe(200);
    expect(hashedRes.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await hashedRes.text()).toBe(featuresBody);
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
