import express, { Router } from 'express';

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { resolve as resolvePath } from 'node:path';

import { mountPreloadEndpoint } from './handler';
import {
  DYNAMIC_FEATURES_BULK_JSON_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
} from './paths';
import { createPreloadStore, type PreloadStore } from './store';

const fixturesRoot = resolvePath(
  __dirname,
  '../__fixtures__/dynamic-plugins-root-for-nfs-filter',
);

function populatedStore(): PreloadStore {
  const store = createPreloadStore();
  store.remotes.push({
    packageName: 'plugin-test-mixed-features-dynamic',
    remoteInfo: {
      name: 'backstage__plugin_test_mixed_features',
      entry:
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/mf-manifest.json',
    },
    exposedModules: ['alpha'],
  });
  store.remoteAssetsPaths['plugin-test-mixed-features-dynamic'] = resolvePath(
    fixturesRoot,
    'test-mixed-features-dynamic',
    'dist',
  );
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
    globalName: 'backstage__plugin_test_mixed_features',
  } as PreloadStore['moduleInfo'][string];

  // An ESM remote (rhdh-cli --shared-esm-runtime emission): skipped by bulk
  // assembler; still modulepreloaded when bulk is active.
  store.remotes.push({
    packageName: 'plugin-test-esm-dynamic',
    remoteInfo: {
      name: 'backstage__plugin_test_esm',
      entry:
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-esm-dynamic/mf-manifest.json',
    },
    exposedModules: ['.'],
  });
  store.remoteAssetsPaths['plugin-test-esm-dynamic'] = resolvePath(
    fixturesRoot,
    'test-mixed-features-dynamic',
    'dist',
  );
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
  opts?: { bulkRemoteEntriesEnabled?: boolean },
) {
  const app = express();
  const router = Router();
  mountPreloadEndpoint(router, store, opts);
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

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  it('serves a no-op comment when the store is empty', async () => {
    ({ server, base } = await startServer(createApp(createPreloadStore())));
    const res = await fetch(`${base}/preload.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('no preload data available');
    expect(res.headers.get('etag')).not.toMatch(/^"[0-9a-f]{8}"$/);
  });

  it('serves preload.js with no-cache and a content-hash ETag', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
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
    ({ server, base } = await startServer(createApp(populatedStore())));
    const res1 = await fetch(`${base}/preload.js`);
    const etag = res1.headers.get('etag')!;

    const res2 = await fetch(`${base}/preload.js`, {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
  });

  it('embeds moduleInfo, remotes shim, and bulk meta when bulk is active', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    expect(body).not.toContain('window.__DYNAMIC_FEATURES_REMOTES__');
    expect(body).toContain('window.__FEDERATION__');
    expect(body).toContain('moduleInfo');
    expect(body).toContain('backstage__plugin_test_mixed_features');

    // Bulk meta for the app wrapper
    expect(body).toContain('window.__DYNAMIC_FEATURES_BULK__');
    expect(body).toContain(DYNAMIC_FEATURES_BULK_JSON_PATH);
    expect(body).toContain('"enabled":true');

    // Mass classic remoteEntry preload stampede disabled
    expect(body).not.toContain('l.as = "script"');
    // Still modulepreloads ESM + shared modules; CSS preload kept
    expect(body).toContain('l.rel = "modulepreload"');
    expect(body).toContain('cl.as = "style"');
    expect(body).not.toContain('document.createElement("script")');

    expect(body).toContain(
      `var remotesPath = ${JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH)}`,
    );
    expect(body).toContain('window.fetch = function(input, init)');

    const remotesMatch = body.match(/var remotes = (\[.+?\]);/s);
    expect(remotesMatch).not.toBeNull();
    const remotes = JSON.parse(remotesMatch![1]);
    expect(remotes[0].exposedModules).toEqual(['alpha']);
  });

  it('serves bulk.json with classic remoteEntry sources and ETag', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const res = await fetch(`${base}/bulk.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/);

    const payload = await res.json();
    expect(payload.version).toBe(1);
    expect(payload.evaluate).toHaveLength(1);
    expect(payload.evaluate[0]).toContain(
      'plugin-test-mixed-features-dynamic/remoteEntry.js',
    );
    expect(payload.sources[payload.evaluate[0]]).toContain('doNothing');
    // ESM remote is not in evaluate
    expect(
      Object.keys(payload.sources).some((u: string) =>
        u.includes('plugin-test-esm-dynamic'),
      ),
    ).toBe(false);
  });

  it('returns 304 for bulk.json when If-None-Match matches', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const res1 = await fetch(`${base}/bulk.json`);
    const etag = res1.headers.get('etag')!;
    const res2 = await fetch(`${base}/bulk.json`, {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
  });

  it('restores mass classic preloads when bulk is disabled', async () => {
    ({ server, base } = await startServer(
      createApp(populatedStore(), { bulkRemoteEntriesEnabled: false }),
    ));
    const body = await (await fetch(`${base}/preload.js`)).text();

    expect(body).toContain('"enabled":false');
    expect(body).toContain('l.as = "script"');
    expect(body).toContain(
      'var entryHref = snap.publicPath + snap.remoteEntry',
    );

    const bulk = await (await fetch(`${base}/bulk.json`)).json();
    expect(bulk.evaluate).toEqual([]);
    expect(bulk.sources).toEqual({});
  });

  it('modulepreloads the canonical shared-module URL for ESM entries', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
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
});
