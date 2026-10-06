import express, { Router } from 'express';

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { mountPreloadEndpoint } from './handler';
import { DYNAMIC_FEATURES_REMOTES_PATH } from './paths';
import { createPreloadStore, type PreloadStore } from './store';

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
  return store;
}

function createApp(store: PreloadStore) {
  const app = express();
  const router = Router();
  mountPreloadEndpoint(router, store);
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
    // Empty-store response skips our content-hash ETag; Express may still
    // attach its own weak ETag from res.send().
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

  it('embeds moduleInfo, local remotes, fetch shim, and script/preload injection', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // remotes must NOT be a window global — only a local var inside the IIFE
    expect(body).not.toContain('window.__DYNAMIC_FEATURES_REMOTES__');

    // MF snapshot global is still required
    expect(body).toContain('window.__FEDERATION__');
    expect(body).toContain('moduleInfo');
    expect(body).toContain('backstage__plugin_test_mixed_features');

    expect(body).toContain('document.createElement("script")');
    expect(body).toContain('snap.publicPath + snap.remoteEntry');
    expect(body).toContain('s.defer = true');
    expect(body).toContain('document.createElement("link")');
    expect(body).toContain('l.rel = "preload"');
    expect(body).toContain('l.as = "script"');
    expect(body).toContain('cl.as = "style"');

    // exposedModules filter was removed — snapshot modules are pre-trimmed
    expect(body).not.toContain('exposed[e]');

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
});
