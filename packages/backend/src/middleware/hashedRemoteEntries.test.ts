import express from 'express';

import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { resolve as resolvePath } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { hashedRemoteEntryName } from '../modules/dynamicFeaturesPreload/remoteEntryHash';
import { registerRemoteEntry } from '../modules/dynamicFeaturesPreload/remoteEntryRegistry';
import {
  HASHED_REMOTE_ENTRY_CACHE_CONTROL,
  hashedRemoteEntriesMiddleware,
} from './hashedRemoteEntries';

const fixturesRoot = resolvePath(
  __dirname,
  '../modules/__fixtures__/dynamic-plugins-root-for-nfs-filter',
);
const PLUGIN_DIR = 'test-mixed-features-dynamic';
const PLUGIN_NAME = 'plugin-test-mixed-features-dynamic';
const REMOTES_BASE = '/.backstage/dynamic-features/remotes';

/** Passthrough terminal handler — proves the middleware called next(). */
const FALLBACK_BODY = 'fell through to the next handler';

function mockLogger(): any {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => undefined,
  };
}

function createApp() {
  const app = express();
  app.use(hashedRemoteEntriesMiddleware());
  app.use((_req, res) => {
    res.status(200).send(FALLBACK_BODY);
  });
  return app;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/**
 * Raw HTTP request with full control over request headers and no
 * transparent response decoding (node fetch auto-decompresses and may
 * inject its own Accept-Encoding, which would hide the negotiation
 * under test).
 */
function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method: 'GET' | 'HEAD' | 'POST' = 'GET',
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('hashedRemoteEntriesMiddleware', () => {
  let server: Server;
  let port: number;
  let entryBytes: Buffer;
  let hashedName: string;
  let hashedPath: string;

  beforeAll(async () => {
    entryBytes = readFileSync(
      resolvePath(fixturesRoot, PLUGIN_DIR, 'dist/remoteEntry.js'),
    );
    hashedName = hashedRemoteEntryName(entryBytes);
    hashedPath = `${REMOTES_BASE}/${PLUGIN_NAME}/${hashedName}`;

    registerRemoteEntry(
      PLUGIN_NAME,
      resolvePath(fixturesRoot, PLUGIN_DIR),
      mockLogger(),
    );

    server = createServer(createApp());
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('serves the hashed entry immutable with the exact registered bytes', async () => {
    const res = await httpGet(port, hashedPath, {
      'Accept-Encoding': 'identity',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/javascript; charset=utf-8',
    );
    expect(res.headers['cache-control']).toBe(
      HASHED_REMOTE_ENTRY_CACHE_CONTROL,
    );
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.vary).toBe('Accept-Encoding');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.equals(entryBytes)).toBe(true);
  });

  it('serves the precomputed brotli encoding when accepted', async () => {
    const res = await httpGet(port, hashedPath, { 'Accept-Encoding': 'br' });

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(res.body).equals(entryBytes)).toBe(true);
  });

  it('serves the precomputed gzip encoding when accepted', async () => {
    const res = await httpGet(port, hashedPath, {
      'Accept-Encoding': 'gzip',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(res.body).equals(entryBytes)).toBe(true);
  });

  it('prefers brotli over gzip when both are accepted', async () => {
    const res = await httpGet(port, hashedPath, {
      'Accept-Encoding': 'gzip, deflate, br',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
  });

  it('answers HEAD requests with headers and no body', async () => {
    const res = await httpGet(port, hashedPath, {}, 'HEAD');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(Number(res.headers['content-length'])).toBe(entryBytes.length);
    expect(res.body).toHaveLength(0);
  });

  it('404s with no-store for an unknown plugin', async () => {
    const res = await httpGet(
      port,
      `${REMOTES_BASE}/unknown-plugin/remoteEntry.0123456789abcdef.js`,
    );

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body.toString('utf8')).toBe('Hashed remote entry not found');
  });

  it('404s with no-store for a known plugin with a stale hash', async () => {
    const res = await httpGet(
      port,
      `${REMOTES_BASE}/${PLUGIN_NAME}/remoteEntry.0000000000000000.js`,
    );

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.toString('utf8')).toBe('Hashed remote entry not found');
  });

  it('passes the literal remoteEntry.js through to the next handler', async () => {
    const res = await httpGet(
      port,
      `${REMOTES_BASE}/${PLUGIN_NAME}/remoteEntry.js`,
    );

    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe(FALLBACK_BODY);
  });

  it('passes mf-manifest.json through to the next handler', async () => {
    const res = await httpGet(
      port,
      `${REMOTES_BASE}/${PLUGIN_NAME}/mf-manifest.json`,
    );

    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe(FALLBACK_BODY);
  });

  it('passes non-matching paths through to the next handler', async () => {
    const res = await httpGet(port, '/static/main.js');

    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe(FALLBACK_BODY);
  });

  it('passes non-GET/HEAD methods through to the next handler', async () => {
    const res = await httpGet(port, hashedPath, {}, 'POST');

    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe(FALLBACK_BODY);
  });
});
