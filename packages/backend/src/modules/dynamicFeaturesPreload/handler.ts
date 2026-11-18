import type { LoggerService } from '@backstage/backend-plugin-api';

import type { Router } from 'express';

import { createHash } from 'node:crypto';

import {
  assembleBulkRemoteEntries,
  type BulkRemoteEntriesArtifact,
} from './bulk';
import {
  DYNAMIC_FEATURES_BULK_JSON_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
} from './paths';
import type { PreloadStore } from './store';

export interface MountPreloadOptions {
  /**
   * When true (default), serve `bulk.json` with classic remoteEntry (+ sync
   * chunk) sources and skip mass classic remoteEntry/sync JS
   * `<link rel=preload>` injection in `preload.js`.
   *
   * Falls back to mass preloads when the bulk assembler finds nothing.
   */
  bulkRemoteEntriesEnabled?: boolean;
  logger?: LoggerService;
}

/**
 * Build the preload.js body from the store contents.
 *
 * Single backend-owned script that does all early dynamic-features work:
 * 1. Prefills `window.__FEDERATION__.moduleInfo` — the MF runtime global
 *    snapshot that lets `@module-federation/runtime-core` skip per-plugin
 *    manifest fetches.
 * 2. Emits `window.__DYNAMIC_FEATURES_BULK__` meta for the app wrapper.
 * 3. In a single IIFE that closes over a local `remotes` array:
 *    a. Installs a `fetch` shim that serves the remotes list without a
 *       network hop when the app later requests the remotes endpoint.
 *    b. When bulk mode is inactive: injects preload hints for each
 *       remoteEntry and for sync chunks of exposed modules (never
 *       executing anything here).
 *    c. When bulk mode is active: skips classic remoteEntry/sync JS
 *       preload stampede (those URLs come from bulk.json + MF hooks).
 *       Still modulepreloads shared `.mjs` / ESM remotes and sync CSS.
 *
 * Remotes data is NOT placed on `window` — nothing in the app or
 * `@backstage/frontend-dynamic-feature-loader` reads it as a global.
 * Snapshot modules are already trimmed to the NFS-filtered exposedModules
 * by the collector, so no runtime match against `exposedModules` is needed.
 */
function buildPreloadBody(
  store: PreloadStore,
  opts: {
    bulkActive: boolean;
    bulkHash?: string;
  },
): string {
  const remotesPathJson = JSON.stringify(DYNAMIC_FEATURES_REMOTES_PATH);
  const bulkMeta = opts.bulkActive
    ? {
        enabled: true,
        hash: opts.bulkHash,
        url: DYNAMIC_FEATURES_BULK_JSON_PATH,
      }
    : { enabled: false };

  const lines: string[] = [
    // --- 1. Prefill MF global snapshot --------------------------------------
    `window.__FEDERATION__ = window.__FEDERATION__ || {};`,
    `window.__FEDERATION__.moduleInfo = Object.assign(`,
    `  window.__FEDERATION__.moduleInfo || {},`,
    `  ${JSON.stringify(store.moduleInfo)}`,
    `);`,
    // Discoverable by the app bulk wrapper / operators.
    `window.__DYNAMIC_FEATURES_BULK__ = ${JSON.stringify(bulkMeta)};`,
    // --- 2. Fetch shim + optional preload injection -------------------------
    `(function() {`,
    `  var remotesPath = ${remotesPathJson};`,
    `  var remotes = ${JSON.stringify(store.remotes)};`,
    `  var info = window.__FEDERATION__.moduleInfo;`,
    // fetch shim: intercept the remotes endpoint and return from local data
    `  var originalFetch = window.fetch;`,
    `  window.fetch = function(input, init) {`,
    `    var url;`,
    `    if (typeof input === "string") { url = input; }`,
    `    else if (input && typeof input.href === "string") { url = input.href; }`,
    `    else if (input && typeof input.url === "string") { url = input.url; }`,
    `    else { url = ""; }`,
    `    if (url.length >= remotesPath.length &&`,
    `        url.slice(-remotesPath.length) === remotesPath) {`,
    `      return Promise.resolve(new Response(JSON.stringify(remotes), {`,
    `        status: 200,`,
    `        headers: { "Content-Type": "application/json" }`,
    `      }));`,
    `    }`,
    `    return originalFetch.apply(this, arguments);`,
    `  };`,
  ];

  if (opts.bulkActive) {
    // Bulk active: no mass classic remoteEntry/sync JS preload stampede.
    // Still modulepreload ESM remoteEntries (not in the classic bulk eval
    // map) and shared runtime modules; keep sync CSS preload hints.
    lines.push(
      `  var frag = document.createDocumentFragment();`,
      `  var seen = {};`,
      `  for (var r = 0; r < remotes.length; r++) {`,
      `    var snap = info[remotes[r].remoteInfo.name];`,
      `    if (!snap || !snap.publicPath) continue;`,
      `    var isEsm = snap.remoteEntryType === "module" || snap.remoteEntryType === "esm";`,
      `    if (isEsm) {`,
      `      var entryHref = snap.publicPath + snap.remoteEntry;`,
      `      if (!seen[entryHref]) {`,
      `        seen[entryHref] = 1;`,
      `        var l = document.createElement("link");`,
      `        l.rel = "modulepreload"; l.href = entryHref;`,
      `        frag.appendChild(l);`,
      `      }`,
      `      var mods = snap.modules || [];`,
      `      for (var m = 0; m < mods.length; m++) {`,
      `        var a = mods[m].assets;`,
      `        if (!a) continue;`,
      `        var js = (a.js && a.js.sync) || [];`,
      `        for (var j = 0; j < js.length; j++) {`,
      `          var href = snap.publicPath + js[j];`,
      `          if (!seen[href]) {`,
      `            seen[href] = 1;`,
      `            var lj = document.createElement("link");`,
      `            lj.rel = "modulepreload"; lj.href = href;`,
      `            frag.appendChild(lj);`,
      `          }`,
      `        }`,
      `        var css = (a.css && a.css.sync) || [];`,
      `        for (var k = 0; k < css.length; k++) {`,
      `          var ch = snap.publicPath + css[k];`,
      `          if (!seen[ch]) {`,
      `            seen[ch] = 1;`,
      `            var cl = document.createElement("link");`,
      `            cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
      `            cl.crossOrigin = "";`,
      `            frag.appendChild(cl);`,
      `          }`,
      `        }`,
      `      }`,
      `    } else {`,
      // Classic: sync CSS only (remoteEntry + sync JS come from bulk.json).
      `      var mods = snap.modules || [];`,
      `      for (var m = 0; m < mods.length; m++) {`,
      `        var a = mods[m].assets;`,
      `        if (!a) continue;`,
      `        var css = (a.css && a.css.sync) || [];`,
      `        for (var k = 0; k < css.length; k++) {`,
      `          var ch = snap.publicPath + css[k];`,
      `          if (!seen[ch]) {`,
      `            seen[ch] = 1;`,
      `            var cl = document.createElement("link");`,
      `            cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
      `            cl.crossOrigin = "";`,
      `            frag.appendChild(cl);`,
      `          }`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
      `  var sharedModules = ${JSON.stringify(store.sharedModuleUrls)};`,
      `  for (var b = 0; b < sharedModules.length; b++) {`,
      `    var bh = sharedModules[b];`,
      `    if (!seen[bh]) {`,
      `      seen[bh] = 1;`,
      `      var bl = document.createElement("link");`,
      `      bl.rel = "modulepreload"; bl.href = bh;`,
      `      frag.appendChild(bl);`,
      `    }`,
      `  }`,
      `  document.head.appendChild(frag);`,
      `})();`,
    );
  } else {
    // Legacy path: mass preload / modulepreload for every remoteEntry + sync.
    lines.push(
      `  var frag = document.createDocumentFragment();`,
      `  var seen = {};`,
      `  for (var r = 0; r < remotes.length; r++) {`,
      `    var snap = info[remotes[r].remoteInfo.name];`,
      `    if (!snap || !snap.publicPath) continue;`,
      `    var isEsm = snap.remoteEntryType === "module" || snap.remoteEntryType === "esm";`,
      `    var entryHref = snap.publicPath + snap.remoteEntry;`,
      `    if (!seen[entryHref]) {`,
      `      seen[entryHref] = 1;`,
      `      var l = document.createElement("link");`,
      `      if (isEsm) { l.rel = "modulepreload"; l.href = entryHref; }`,
      `      else { l.rel = "preload"; l.href = entryHref; l.as = "script"; }`,
      `      frag.appendChild(l);`,
      `    }`,
      `    var mods = snap.modules || [];`,
      `    for (var m = 0; m < mods.length; m++) {`,
      `      var a = mods[m].assets;`,
      `      if (!a) continue;`,
      `      var js = (a.js && a.js.sync) || [];`,
      `      for (var j = 0; j < js.length; j++) {`,
      `        var href = snap.publicPath + js[j];`,
      `        if (!seen[href]) {`,
      `          seen[href] = 1;`,
      `          var l = document.createElement("link");`,
      `          if (isEsm) { l.rel = "modulepreload"; l.href = href; }`,
      `          else { l.rel = "preload"; l.href = href; l.as = "script"; }`,
      `          frag.appendChild(l);`,
      `        }`,
      `      }`,
      `      var css = (a.css && a.css.sync) || [];`,
      `      for (var k = 0; k < css.length; k++) {`,
      `        var ch = snap.publicPath + css[k];`,
      `        if (!seen[ch]) {`,
      `          seen[ch] = 1;`,
      `          var cl = document.createElement("link");`,
      `          cl.rel = "preload"; cl.href = ch; cl.as = "style";`,
      `          cl.crossOrigin = "";`,
      `          frag.appendChild(cl);`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
      `  var sharedModules = ${JSON.stringify(store.sharedModuleUrls)};`,
      `  for (var b = 0; b < sharedModules.length; b++) {`,
      `    var bh = sharedModules[b];`,
      `    if (!seen[bh]) {`,
      `      seen[bh] = 1;`,
      `      var bl = document.createElement("link");`,
      `      bl.rel = "modulepreload"; bl.href = bh;`,
      `      frag.appendChild(bl);`,
      `    }`,
      `  }`,
      `  document.head.appendChild(frag);`,
      `})();`,
    );
  }

  return lines.join('\n');
}

/**
 * Compute a content hash (8 hex chars) for use as an ETag on preload.js.
 */
function contentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8);
}

function sendWithETag(
  req: { headers: Record<string, unknown> },
  res: {
    setHeader: (k: string, v: string) => void;
    status: (n: number) => { end: () => void };
    send: (body: string) => void;
  },
  body: string,
  etag: string,
  contentType: string,
  cacheControl: string,
): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.send(body);
}

/**
 * Mount the preload + bulk endpoints on the given router.
 *
 * Serves `preload.js` and (when bulk mode is active) `bulk.json` with
 * revalidation caching:
 *   Cache-Control: no-cache   — browser may cache but must revalidate
 *   ETag: "<content-hash>"    — enables 304 Not Modified on revalidation
 *
 * The store is populated by the upstream remotes router during its startup
 * hook. HTTP requests only arrive after all startup hooks complete, so the
 * store is guaranteed to be ready when these handlers run.
 */
export function mountPreloadEndpoint(
  router: Router,
  store: PreloadStore,
  options: MountPreloadOptions = {},
): void {
  const bulkEnabled = options.bulkRemoteEntriesEnabled ?? true;
  const logger = options.logger;

  let cachedBulk: BulkRemoteEntriesArtifact | undefined | null = null;
  let cachedPreloadBody: string | undefined;
  let cachedPreloadETag: string | undefined;
  let cachedBulkActive: boolean | undefined;

  function ensureBulk(): BulkRemoteEntriesArtifact | undefined {
    if (!bulkEnabled) {
      return undefined;
    }
    if (cachedBulk === null) {
      cachedBulk = assembleBulkRemoteEntries(store, logger);
      if (cachedBulk) {
        logger?.info(
          `dynamic-features-bulk: assembled ${cachedBulk.includedRemoteEntries.length} classic remoteEntries` +
            ` + ${cachedBulk.includedSyncChunkUrls.length} sync chunks` +
            ` (hash=${cachedBulk.hash}` +
            (cachedBulk.skipped.length
              ? `, skipped=${cachedBulk.skipped.length}`
              : '') +
            `)`,
        );
      }
    }
    return cachedBulk ?? undefined;
  }

  function ensurePreload(): { body: string; etag: string } | undefined {
    if (store.remotes.length === 0) {
      return undefined;
    }
    const bulk = ensureBulk();
    const bulkActive = !!bulk;
    if (!cachedPreloadBody || cachedBulkActive !== bulkActive) {
      cachedPreloadBody = buildPreloadBody(store, {
        bulkActive,
        bulkHash: bulk?.hash,
      });
      cachedPreloadETag = `"${contentHash(cachedPreloadBody)}"`;
      cachedBulkActive = bulkActive;
    }
    return { body: cachedPreloadBody, etag: cachedPreloadETag! };
  }

  router.get('/preload.js', (req, res) => {
    const result = ensurePreload();
    if (!result) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send('// dynamic-features-preload: no preload data available\n');
      return;
    }

    sendWithETag(
      req,
      res,
      result.body,
      result.etag,
      'application/javascript; charset=utf-8',
      'no-cache',
    );
  });

  router.get('/bulk.json', (req, res) => {
    const bulk = ensureBulk();
    if (!bulk) {
      // Empty payload when disabled / nothing to include — client no-ops.
      const empty = '{"version":1,"sources":{},"evaluate":[]}\n';
      sendWithETag(
        req,
        res,
        empty,
        `"${contentHash(empty)}"`,
        'application/json; charset=utf-8',
        'no-cache',
      );
      return;
    }

    sendWithETag(
      req,
      res,
      bulk.body,
      `"${bulk.hash}"`,
      'application/json; charset=utf-8',
      'no-cache',
    );
  });
}
