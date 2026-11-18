import express, { Router } from 'express';

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashFeaturesBody } from './bootstrap';
import { mountPreloadEndpoint } from './handler';
import {
  DYNAMIC_FEATURES_REMOTES_PATH,
  featuresBootstrapHashedPath,
} from './paths';
import { createPreloadStore, type PreloadStore } from './store';

function populatedStore(assetsDir: string): PreloadStore {
  const store = createPreloadStore();
  writeFileSync(
    join(assetsDir, 'remoteEntry.js'),
    'window.backstage__plugin_test_mixed_features = { get() {}, init() {} };',
  );

  store.remotes.push({
    packageName: 'plugin-test-mixed-features-dynamic',
    remoteInfo: {
      name: 'backstage__plugin_test_mixed_features',
      entry:
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/mf-manifest.json',
    },
    exposedModules: ['alpha'],
  });
  store.remoteAssetsPaths['plugin-test-mixed-features-dynamic'] = assetsDir;
  store.moduleInfo.backstage__plugin_test_mixed_features = {
    name: 'backstage__plugin_test_mixed_features',
    version: 'v',
    buildVersion: '0.0.0',
    remotesInfo: [],
    shared: [],
    modules: [
      {
        moduleName: 'alpha',
        modulePath: './alpha',
        assets: {
          js: {
            sync: [
              'static/3000.aaa11111.chunk.js',
              'static/4000.bbb22222.chunk.js',
            ],
            async: [],
          },
          css: { sync: ['static/alpha.ddd44444.css'], async: [] },
        },
      },
    ],
    publicPath:
      'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/',
    remoteEntry: 'remoteEntry.js',
    remoteEntryType: 'global',
    globalName: 'backstage__plugin_test_mixed_features',
  } as PreloadStore['moduleInfo'][string];

  // An ESM remote (rhdh-cli --shared-esm-runtime emission): the snapshot
  // carries remoteEntryType "module" (derived by generateSnapshotFromManifest
  // from metaData.remoteEntry.type) and the store carries the canonical
  // shared-module URL (populated by the resolver's dist/shared/ scan) —
  // what the remoteEntry's baked relative runtime external resolves to.
  store.remotes.push({
    packageName: 'plugin-test-esm-dynamic',
    remoteInfo: {
      name: 'backstage__plugin_test_esm',
      entry:
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-esm-dynamic/mf-manifest.json',
    },
    exposedModules: ['.'],
  });
  store.remoteAssetsPaths['plugin-test-esm-dynamic'] = assetsDir;
  store.moduleInfo.backstage__plugin_test_esm = {
    name: 'backstage__plugin_test_esm',
    version: 'v',
    buildVersion: '0.0.0',
    remotesInfo: [],
    shared: [],
    modules: [
      {
        moduleName: '.',
        modulePath: '.',
        assets: {
          js: { sync: ['static/5000.eee55555.chunk.mjs'], async: [] },
          css: { sync: [], async: [] },
        },
      },
    ],
    publicPath:
      'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-esm-dynamic/',
    remoteEntry: 'remoteEntry.js',
    remoteEntryType: 'module',
    globalName: 'backstage__plugin_test_esm',
  } as PreloadStore['moduleInfo'][string];
  store.sharedModuleUrls.push(
    'http://localhost:7007/.backstage/dynamic-features-shared-modules/webpack-bundler-runtime@2.8.0-0123abcd4567ef89.mjs',
  );
  return store;
}

function createApp(
  store: PreloadStore,
  options?: Parameters<typeof mountPreloadEndpoint>[2],
) {
  const app = express();
  const router = Router();
  mountPreloadEndpoint(router, store, options);
  app.use(router);
  return app;
}

async function startServer(
  app: express.Express,
): Promise<{ server: Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('expected TCP address'));
        return;
      }
      resolve({ server, base: `http://127.0.0.1:${addr.port}` });
    });
    server.on('error', reject);
  });
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
}

describe('mountPreloadEndpoint', () => {
  let server: Server;
  let base: string;
  let assetsDir: string;

  beforeEach(() => {
    assetsDir = mkdtempSync(join(tmpdir(), 'rhdh-preload-handler-'));
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
    rmSync(assetsDir, { recursive: true, force: true });
  });

  it('serves a no-op comment when the store is empty', async () => {
    ({ server, base } = await startServer(createApp(createPreloadStore())));
    const res = await fetch(`${base}/preload.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('no preload data available');
    // Empty-store response skips our content-hash ETag; Express may still
    // attach its own weak ETag from res.send().
    expect(res.headers.get('etag')).not.toMatch(/^"[0-9a-f]{8}"$/);
  });

  it('serves preload.js with no-cache and a content-hash ETag', async () => {
    ({ server, base } = await startServer(
      createApp(populatedStore(assetsDir)),
    ));
    const res = await fetch(`${base}/preload.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{8}"$/);

    const body = await res.text();
    const expectedHash = createHash('sha256')
      .update(body)
      .digest('hex')
      .slice(0, 8);
    expect(etag).toBe(`"${expectedHash}"`);
  });

  it('returns 304 when If-None-Match matches the ETag', async () => {
    ({ server, base } = await startServer(
      createApp(populatedStore(assetsDir)),
    ));
    const res1 = await fetch(`${base}/preload.js`);
    const etag = res1.headers.get('etag')!;

    const res2 = await fetch(`${base}/preload.js`, {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
  });

  it('embeds moduleInfo, local remotes, fetch shim, and bootstrap meta when bootstrap is on', async () => {
    ({ server, base } = await startServer(
      createApp(populatedStore(assetsDir)),
    ));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // remotes must NOT be a window global — only a local var inside the IIFE
    expect(body).not.toContain('window.__DYNAMIC_FEATURES_REMOTES__');

    // MF snapshot global is still required
    expect(body).toContain('window.__FEDERATION__');
    expect(body).toContain('moduleInfo');
    expect(body).toContain('backstage__plugin_test_mixed_features');
    expect(body).toContain('window.__DYNAMIC_FEATURES_BOOTSTRAP__');
    expect(body).toContain('"enabled":true');

    // Mass classic remoteEntry/sync JS preloads are disabled (no as=script).
    // ESM remotes still modulepreload via entryHref inside `if (isEsm)`.
    expect(body).not.toContain('l.as = "script"');
    expect(body).toContain('if (isEsm)');
    // CSS preload + ESM modulepreload remain
    expect(body).toContain('cl.as = "style"');
    expect(body).toContain('l.rel = "modulepreload"');
    expect(body).not.toContain('document.createElement("script")');

    expect(body).toContain(
      `var remotesPath = ${JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH)}`,
    );
    expect(body).toContain('window.fetch = function(input, init)');
    expect(body).toContain('originalFetch.apply(this, arguments)');

    // Parse the local `var remotes = [...]` inside the IIFE
    const remotesMatch = body.match(/var remotes = (\[.+?\]);/s);
    expect(remotesMatch).not.toBeNull();
    const remotes = JSON.parse(remotesMatch![1]);
    expect(remotes[0].exposedModules).toEqual(['alpha']);

    const moduleInfoMatch = body.match(
      /Object\.assign\(\s*window\.__FEDERATION__\.moduleInfo \|\| \{\},\s*(\{.+?\})\s*\)/s,
    );
    expect(moduleInfoMatch).not.toBeNull();
    const moduleInfo = JSON.parse(moduleInfoMatch![1]);
    const snap = moduleInfo.backstage__plugin_test_mixed_features;
    expect(snap.remoteEntry).toBe('remoteEntry.js');
    expect(
      snap.modules.map((m: { moduleName: string }) => m.moduleName),
    ).toEqual(['alpha']);
  });

  it('modulepreloads the canonical shared-module URL for ESM entries', async () => {
    ({ server, base } = await startServer(
      createApp(populatedStore(assetsDir)),
    ));
    const body = await (await fetch(`${base}/preload.js`)).text();

    expect(body).toContain(
      'snap.remoteEntryType === "module" || snap.remoteEntryType === "esm"',
    );
    expect(body).toContain('l.rel = "modulepreload"');
    expect(body).toContain('"remoteEntryType":"module"');
    expect(body).toContain('static/5000.eee55555.chunk.mjs');

    expect(body).toContain(
      'var sharedModules = ["http://localhost:7007/.backstage/dynamic-features-shared-modules/webpack-bundler-runtime@2.8.0-0123abcd4567ef89.mjs"]',
    );
    expect(body).toContain('bl.rel = "modulepreload"');
  });

  it('restores mass remoteEntry/sync preloads when bootstrap is disabled', async () => {
    ({ server, base } = await startServer(
      createApp(populatedStore(assetsDir), {
        featuresBootstrapEnabled: false,
      }),
    ));
    const body = await (await fetch(`${base}/preload.js`)).text();
    expect(body).toContain('"enabled":false');
    expect(body).toContain(
      'var entryHref = snap.publicPath + snap.remoteEntry',
    );
    expect(body).toContain('l.as = "script"');

    const features = await fetch(`${base}/features.js`);
    expect(await features.text()).toContain('no features bootstrap available');
  });

  it('serves features.js and features.<hash>.js with correct caching', async () => {
    const store = populatedStore(assetsDir);
    ({ server, base } = await startServer(createApp(store)));

    const res = await fetch(`${base}/features.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain(
      'window.backstage__plugin_test_mixed_features = { get() {}, init() {} };',
    );
    expect(body).toContain('plugin-test-mixed-features-dynamic');

    const hash = hashFeaturesBody(body);
    expect(res.headers.get('etag')).toBe(`"${hash}"`);
    // Absolute path helper stays in sync with the served route name.
    expect(featuresBootstrapHashedPath(hash)).toContain(`features.${hash}.js`);

    // mount is at router root in this unit test → /features.<hash>.js
    const hashedDirect = await fetch(`${base}/features.${hash}.js`);
    expect(hashedDirect.status).toBe(200);
    expect(hashedDirect.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await hashedDirect.text()).toBe(body);

    const miss = await fetch(`${base}/features.deadbeefdeadbeef.js`);
    expect(miss.status).toBe(404);
  });
});
