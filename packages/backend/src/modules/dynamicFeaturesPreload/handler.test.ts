import express, { Router } from 'express';

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { runInNewContext } from 'node:vm';

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

  // A fully-filtered remote: all exposed modules removed by the NFS
  // filter. The loader never loadRemote's it, so no hint may be emitted.
  store.remotes.push({
    packageName: 'plugin-test-fully-filtered-dynamic',
    remoteInfo: {
      name: 'backstage__plugin_test_fully_filtered',
      entry:
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-fully-filtered-dynamic/mf-manifest.json',
    },
    exposedModules: [],
  });
  store.moduleInfo.backstage__plugin_test_fully_filtered = {
    name: 'backstage__plugin_test_fully_filtered',
    version: 'v',
    buildVersion: '0.0.0',
    remotesInfo: [],
    shared: [],
    modules: [],
    publicPath:
      'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-fully-filtered-dynamic/',
    remoteEntry: 'remoteEntry.js',
    remoteEntryType: 'global',
    globalName: 'backstage__plugin_test_fully_filtered',
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

/**
 * Execute the emitted preload.js body against DOM/fetch stubs and return
 * the link elements that reach the document. Models the DOM faithfully
 * enough to catch emission bugs: links are collected into a
 * DocumentFragment and only land in the document when the fragment is
 * appended to the head — a body that fills the fragment but never
 * inserts it returns no links. The fetch shim is never invoked (no
 * remotes call), and nothing touches the network.
 */
function runPreloadBody(body: string) {
  const inDocument: any[] = [];
  const fragment = {
    children: [] as any[],
    appendChild(el: any) {
      this.children.push(el);
    },
  };
  const head = {
    appendChild(el: any) {
      if (el === fragment) {
        inDocument.push(...fragment.children);
      } else {
        inDocument.push(el);
      }
    },
  };
  runInNewContext(body, {
    window: { __FEDERATION__: {}, fetch: () => undefined },
    document: {
      head,
      createDocumentFragment: () => fragment,
      createElement: () =>
        ({
          rel: '',
          href: '',
          as: '',
          crossOrigin: undefined,
          fetchPriority: undefined,
        }) as any,
    },
  });
  return inDocument;
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

  it('embeds moduleInfo, local remotes, fetch shim, and preload injection', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // remotes must NOT be a window global — only a local var inside the IIFE
    expect(body).not.toContain('window.__DYNAMIC_FEATURES_REMOTES__');

    // MF snapshot global is still required
    expect(body).toContain('window.__FEDERATION__');
    expect(body).toContain('moduleInfo');
    expect(body).toContain('backstage__plugin_test_mixed_features');

    expect(body).toContain(
      'var entryHref = snap.publicPath + snap.remoteEntry',
    );
    expect(body).toContain('l.rel = "preload"');
    expect(body).toContain('l.as = "script"');
    // Nothing is ever executed here: classic entries are cache-warmed only
    // (execution happens later via the MF runtime at loadRemote), and ESM
    // entries cannot be executed as classic scripts at all.
    expect(body).not.toContain('document.createElement("script")');
    expect(body).toContain('document.createElement("link")');
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
    // Empty arrays/objects/strings are stripped from the embedded snapshot
    expect(snap.shared).toBeUndefined();
    expect(snap.remotesInfo).toBeUndefined();
    expect(snap.modules[0].assets.js.async).toBeUndefined();
    expect(snap.modules[0].assets.css.async).toBeUndefined();
    expect(snap.modules[0].assets.css.sync).toEqual([
      'static/alpha.ddd44444.css',
    ]);
    // Fully-filtered remote keeps identity fields but drops empty modules
    const filtered = moduleInfo.backstage__plugin_test_fully_filtered;
    expect(filtered.remoteEntry).toBe('remoteEntry.js');
    expect(filtered.modules).toBeUndefined();
  });

  it('modulepreloads the canonical shared-module URL for ESM entries', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // ESM detection is snapshot-driven
    expect(body).toContain(
      'snap.remoteEntryType === "module" || snap.remoteEntryType === "esm"',
    );
    expect(body).toContain('l.rel = "modulepreload"');

    // The ESM remote's snapshot (with its remoteEntryType) is embedded, and
    // its sync chunks are modulepreloaded, not preloaded as scripts
    expect(body).toContain('"remoteEntryType":"module"');
    expect(body).toContain('static/5000.eee55555.chunk.mjs');

    // The canonical shared-module URL (what the baked relative runtime
    // external resolves to) is modulepreloaded
    expect(body).toContain(
      'var sharedModules = ["http://localhost:7007/.backstage/dynamic-features-shared-modules/webpack-bundler-runtime@2.8.0-0123abcd4567ef89.mjs"]',
    );
    expect(body).toContain('bl.rel = "modulepreload"');
  });

  it('emits shared modules before remote links and chunk hints at low priority', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // Every ESM entry's evaluation gates on the shared modules, so their
    // links must be emitted before the per-remote entry/chunk links —
    // under connection-limited transports, queue position is latency.
    const sharedLoop = body.indexOf('var sharedModules = ');
    const remotesLoop = body.indexOf(
      'for (var r = 0; r < remotes.length; r++)',
    );
    expect(sharedLoop).toBeGreaterThan(-1);
    expect(remotesLoop).toBeGreaterThan(sharedLoop);

    // The batched links must actually reach the document: the fragment
    // is inserted into the head once, after the loops.
    const insertFrag = body.indexOf('document.head.appendChild(frag);');
    expect(insertFrag).toBeGreaterThan(remotesLoop);

    // Sync-chunk JS hints are warmed at low priority so they do not
    // preempt the app's own deferred module scripts; remoteEntry links
    // stay at the default (high) priority, and CSS chunk hints keep the
    // default priority (few, and they style the shell).
    expect(body).toContain('l.fetchPriority = "low"');
    expect(body).not.toContain('cl.fetchPriority');
    const entryEmit = body.indexOf(
      'l.rel = "modulepreload"; l.href = entryHref',
    );
    const chunkEmit = body.indexOf('l.fetchPriority = "low"');
    expect(entryEmit).toBeGreaterThan(-1);
    expect(chunkEmit).toBeGreaterThan(entryEmit);
  });

  it('preloads CSS without crossorigin so the runtime stylesheet matches the cache key', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // The plugin runtime inserts its stylesheets without crossorigin
    // (no-cors mode); CORS mode is part of the preload cache key, so a
    // cors-mode preload would force a second download of every CSS.
    expect(body).not.toContain('crossOrigin');

    const cssLinks = runPreloadBody(body).filter(l => l.as === 'style');
    expect(cssLinks.map(l => l.href)).toEqual([
      'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/static/alpha.ddd44444.css',
    ]);
    for (const link of cssLinks) {
      expect(link.crossOrigin).toBeUndefined();
    }
  });

  it('emits no hints for remotes whose exposed modules were all filtered away', async () => {
    ({ server, base } = await startServer(createApp(populatedStore())));
    const body = await (await fetch(`${base}/preload.js`)).text();

    // The gate itself
    expect(body).toContain(
      'if (!snap.modules || snap.modules.length === 0) continue;',
    );

    // Executing the emitted script: the fully-filtered remote (listed in
    // the fetch shim with empty exposedModules — the loader maps over
    // that empty list and loads nothing) must contribute no link, while
    // the other remotes' entries are still hinted.
    const hrefs = runPreloadBody(body).map(l => l.href);
    expect(
      hrefs.some(h => h.includes('plugin-test-fully-filtered-dynamic')),
    ).toBe(false);
    expect(
      hrefs.includes(
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-mixed-features-dynamic/remoteEntry.js',
      ),
    ).toBe(true);
    expect(
      hrefs.includes(
        'http://localhost:7007/.backstage/dynamic-features/remotes/plugin-test-esm-dynamic/remoteEntry.js',
      ),
    ).toBe(true);
  });
});
