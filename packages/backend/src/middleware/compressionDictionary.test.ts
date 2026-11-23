import express from 'express';

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { hashedRemoteEntryName } from '../modules/dynamicFeaturesPreload/remoteEntryHash';
import {
  buildCompressionDictionaries,
  computeDictionaryHash,
  createCompressionDictionaryMiddleware,
  normalizeDictionaryHash,
  parseDczBody,
  type CompressionDictionary,
  type CompressionDictionaryAssetClass,
  type CompressionDictionaryMiddlewareOptions,
} from './compressionDictionary';

const REMOTES = '/.backstage/dynamic-features/remotes/';
const PLUGIN_A = '@internal/backstage-plugin-page-1-dynamic';
const PLUGIN_B = '@internal/backstage-plugin-page-2-dynamic';
const STATIC_PATH = '/static/main.46883497d9c7.js';

// Varied but shared code, so the unassisted Brotli payload is not already
// smaller than the dcz framing overhead.
const modules = Array.from(
  { length: 120 },
  (_, i) =>
    `__webpack_modules__[${9000 + i}]=function(e,t,n){n.r(t);const r${i}=e("/api/shared/${i * i + 19}");t.default=()=>r${i}.then(x=>x.value*${i}+${i * i * i});};`,
).join('');
const ENTRY_A = `const name="page_1";${modules}export var get=1,init=2;`;
const ENTRY_B = `const name="page_2";${modules}export var get=3,init=4;`;
// Browsers request entries under their content-hashed URLs; the literal
// remoteEntry.js name remains the fallback path.
const ENTRY_A_PATH = `${REMOTES}${PLUGIN_A}/${hashedRemoteEntryName(
  Buffer.from(ENTRY_A),
)}`;
const ENTRY_B_PATH = `${REMOTES}${PLUGIN_B}/${hashedRemoteEntryName(
  Buffer.from(ENTRY_B),
)}`;
const ENTRY_B_LITERAL = `${REMOTES}${PLUGIN_B}/remoteEntry.js`;

const EXPOSE_CHUNK_A =
  'static/__federation_expose_default_export.aaaa1111.chunk.js';
const EXPOSE_CHUNK_B =
  'static/__federation_expose_default_export.bbbb2222.chunk.js';
const SYNC_CHUNK_A = 'static/1805.aaaa1111.chunk.js';
const SYNC_CHUNK_B = 'static/1805.bbbb2222.chunk.js';
const ASYNC_CHUNK_A = 'static/317.aaaa1111.chunk.js';
const ASYNC_CHUNK_B = 'static/317.bbbb2222.chunk.js';
const EXPOSE_A_URL = `${REMOTES}${PLUGIN_A}/${EXPOSE_CHUNK_A}`;
const SYNC_B_URL = `${REMOTES}${PLUGIN_B}/${SYNC_CHUNK_B}`;
const ASYNC_A_URL = `${REMOTES}${PLUGIN_A}/${ASYNC_CHUNK_A}`;

interface RawResponse {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function request(
  base: string,
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(urlPath, base), { headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(
  app: express.Express,
  run: (base: string) => Promise<void>,
) {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
  }
}

function offer(dictionary: Buffer) {
  return {
    'Accept-Encoding': 'gzip, dcz',
    'Available-Dictionary': `:${computeDictionaryHash(dictionary)}:`,
  };
}

function linkUrls(link: string | string[] | undefined): string[] {
  let values: string[];
  if (Array.isArray(link)) {
    values = link;
  } else if (link) {
    values = [link];
  } else {
    values = [];
  }
  return values.flatMap(value =>
    [...value.matchAll(/<([^>]+)>/g)].map(match => match[1]),
  );
}

function dictionaryFor(
  dictionaries: CompressionDictionary[],
  assetClass: CompressionDictionaryAssetClass,
): CompressionDictionary {
  const dictionary = dictionaries.find(d => d.classes.includes(assetClass));
  if (!dictionary) throw new Error(`No ${assetClass} dictionary`);
  return dictionary;
}

describe('compression dictionary middleware', () => {
  let pluginsRoot: string;
  let served: Map<string, Buffer>;

  beforeEach(async () => {
    pluginsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-cd-plugins-'));
    served = new Map([[STATIC_PATH, Buffer.from('console.log("app")')]]);
  });

  afterEach(async () => {
    await fs.rm(pluginsRoot, { recursive: true, force: true });
  });

  async function install(
    name: string,
    assets: Record<string, string>,
    {
      role = 'frontend-plugin',
      declaredEntry = 'remoteEntry.js',
      exposes = [],
    }: {
      role?: string;
      declaredEntry?: string;
      exposes?: {
        name: string;
        assets?: { js?: { sync?: string[]; async?: string[] } };
      }[];
    } = {},
  ) {
    const pluginDir = path.join(pluginsRoot, name.split('/').at(-1)!);
    const dist = path.join(pluginDir, 'dist');
    await fs.mkdir(dist, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({ name, main: 'index.js', backstage: { role } }),
    );
    await fs.writeFile(
      path.join(dist, 'mf-manifest.json'),
      JSON.stringify({
        name,
        exposes,
        metaData: { remoteEntry: { name: declaredEntry, path: '' } },
      }),
    );
    for (const [asset, text] of Object.entries(assets)) {
      const file = path.join(dist, asset);
      const bytes = Buffer.from(text);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      served.set(`${REMOTES}${name}/${asset}`, bytes);
      // The content-hashed entry URL is what browsers request (the resolver
      // rewrites the manifest at serving time); serve it too so requests
      // that fall through the compression middleware reach the fallback.
      if (asset === 'remoteEntry.js') {
        served.set(`${REMOTES}${name}/${hashedRemoteEntryName(bytes)}`, bytes);
      }
    }
  }

  async function installEntries(a = ENTRY_A, b = ENTRY_B) {
    await install(PLUGIN_A, { 'remoteEntry.js': a });
    await install(PLUGIN_B, { 'remoteEntry.js': b });
  }

  /** Two plugins shipping a remote entry, expose/sync/async chunks. */
  async function installChunkFleet() {
    await install(
      PLUGIN_A,
      {
        'remoteEntry.js': ENTRY_A,
        [EXPOSE_CHUNK_A]: `${modules}fetch("plugin://plugin-a/expose");`,
        [SYNC_CHUNK_A]: `${modules}fetch("plugin://plugin-a/sync");`,
        [ASYNC_CHUNK_A]: `${modules}fetch("plugin://plugin-a/async");`,
      },
      {
        exposes: [
          {
            name: '.',
            assets: {
              js: {
                sync: [EXPOSE_CHUNK_A, SYNC_CHUNK_A],
                async: [ASYNC_CHUNK_A],
              },
            },
          },
        ],
      },
    );
    await install(
      PLUGIN_B,
      {
        'remoteEntry.js': ENTRY_B,
        [EXPOSE_CHUNK_B]: `${modules}fetch("plugin://plugin-b/expose");`,
        [SYNC_CHUNK_B]: `${modules}fetch("plugin://plugin-b/sync");`,
        [ASYNC_CHUNK_B]: `${modules}fetch("plugin://plugin-b/async");`,
      },
      {
        exposes: [
          {
            name: '.',
            assets: {
              js: {
                sync: [EXPOSE_CHUNK_B, SYNC_CHUNK_B],
                async: [ASYNC_CHUNK_B],
              },
            },
          },
        ],
      },
    );
  }

  function createApp({
    root = pluginsRoot,
    gzip = false,
    middlewareOptions = {},
  }: {
    root?: string;
    gzip?: boolean;
    middlewareOptions?: CompressionDictionaryMiddlewareOptions;
  } = {}) {
    const app = express();
    app.use(
      createCompressionDictionaryMiddleware({
        pluginsRootDirectory: root,
        ...middlewareOptions,
      }),
    );
    app.get('/', (_req, res) => res.type('html').send('<html></html>'));
    app.use((req, res) => {
      const body = served.get(req.path);
      if (!body) {
        res.status(404).end();
        return;
      }
      res.type('js');
      if (gzip && req.acceptsEncodings('gzip')) {
        res.set('Content-Encoding', 'gzip').send(zlib.gzipSync(body));
      } else {
        res.send(body);
      }
    });
    return app;
  }

  it('computes a SHA-256 base64 hash and normalizes padding', () => {
    const bytes = Buffer.from(ENTRY_A);
    const hash = createHash('sha256').update(bytes).digest('base64');
    expect(computeDictionaryHash(bytes)).toBe(hash);
    expect(normalizeDictionaryHash(`::${hash}:`)).toBe(hash);
  });

  it('passes through entries and chunks when the scan is unavailable', async () => {
    await installChunkFleet();
    await withServer(
      createApp({ root: path.join(pluginsRoot, 'missing') }),
      async base => {
        expect((await request(base, '/')).headers.link).toBeUndefined();
        const entry = await request(base, ENTRY_A_PATH);
        expect(entry.status).toBe(200);
        expect(entry.body.toString()).toBe(ENTRY_A);
        expect(entry.headers['use-as-dictionary']).toBeUndefined();
        expect(entry.headers.vary).toBeUndefined();
        const chunk = await request(base, SYNC_B_URL);
        expect(chunk.body.toString()).toBe(
          `${modules}fetch("plugin://plugin-b/sync");`,
        );
        expect(chunk.headers['use-as-dictionary']).toBeUndefined();
        expect(chunk.headers.vary).toBeUndefined();
        const asset = await request(base, STATIC_PATH);
        expect(asset.body.toString()).toBe('console.log("app")');
      },
    );
  });

  it('preloads a versioned raw dictionary and serves dcz on the first entry request', async () => {
    await installEntries();
    await withServer(createApp(), async base => {
      const home = await request(base, '/');
      const link = String(home.headers.link);
      const match =
        /^<([^>]+)>; rel=preload; as=fetch; fetchpriority="high"$/.exec(link);
      if (!match) throw new Error(`Unexpected preload header: ${link}`);
      const dictionaryUrl = match[1];
      const response = await request(base, dictionaryUrl, {
        'Accept-Encoding': 'gzip, br',
      });
      expect(response.status).toBe(200);
      expect(response.headers['content-encoding']).toBe('br');
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers.vary).toBe('Accept-Encoding');
      expect(response.headers['cache-control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(response.headers['use-as-dictionary']).toBe(
        `match="${REMOTES}*/remoteEntry*"`,
      );
      const dictionary = zlib.brotliDecompressSync(response.body);
      const digest = createHash('sha256').update(dictionary).digest();
      expect(dictionaryUrl).toMatch(
        new RegExp(`remote-entry-${digest.toString('hex')}\\.dat$`),
      );
      expect(dictionary.length).toBeLessThan(
        (ENTRY_A.length + ENTRY_B.length) * 0.7,
      );
      expect(
        (await request(base, '/api/something')).headers.link,
      ).toBeUndefined();
      const staleUrl = dictionaryUrl.replace(/-[a-f0-9]+\.dat$/, '-old.dat');
      expect((await request(base, staleUrl)).status).toBe(404);

      const headers = offer(dictionary);
      const entry = await request(base, ENTRY_B_PATH, headers);
      expect(entry.status).toBe(200);
      expect(entry.headers['content-encoding']).toBe('dcz');
      expect(entry.headers.vary).toBe('Accept-Encoding, Available-Dictionary');
      // Hashed entry URLs are content-addressed and cache immutable,
      // matching hashedRemoteEntriesMiddleware.
      expect(entry.headers['cache-control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(entry.headers['x-content-type-options']).toBe('nosniff');
      expect(entry.headers['use-as-dictionary']).toBeUndefined();
      const { dictionaryDigest, zstdBody } = parseDczBody(entry.body);
      expect(dictionaryDigest).toEqual(digest);
      expect(zlib.zstdDecompressSync(zstdBody, { dictionary }).toString()).toBe(
        ENTRY_B,
      );
      const revalidated = await request(base, ENTRY_B_PATH, {
        ...headers,
        'If-None-Match': String(entry.headers.etag),
      });
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers.etag).toBe(entry.headers.etag);
      expect(revalidated.headers.vary).toBe(entry.headers.vary);
      expect(revalidated.headers['content-encoding']).toBeUndefined();
      expect(revalidated.body).toHaveLength(0);

      // The literal fallback entry URL matches the dictionary pattern (so a
      // browser would offer it) but has no corpus body: normal serving.
      const literal = await request(base, ENTRY_B_LITERAL, headers);
      expect(literal.status).toBe(200);
      expect(literal.headers['content-encoding']).toBeUndefined();
      expect(literal.body.toString()).toBe(ENTRY_B);
    });
  });

  it('uses normal serving for missing or stale dictionaries, excluded encodings and ranged requests', async () => {
    await installEntries();
    const { dictionaries } = await buildCompressionDictionaries(pluginsRoot);
    const current = offer(dictionaryFor(dictionaries, 'remote-entry').raw);
    await withServer(createApp({ gzip: true }), async base => {
      const offers: Record<string, string>[] = [
        { 'Accept-Encoding': 'gzip' },
        offer(Buffer.from('stale dictionary')),
        { ...current, 'Accept-Encoding': 'gzip, dcz;q=0' },
        { ...current, Range: 'bytes=0-10' },
      ];
      for (const headers of offers) {
        const res = await request(base, ENTRY_B_PATH, headers);
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(zlib.gunzipSync(res.body).toString()).toBe(ENTRY_B);
        expect(res.headers['use-as-dictionary']).toBeUndefined();
        expect(res.headers.vary).toBe('Accept-Encoding, Available-Dictionary');
      }
    });
  });

  it('excludes undeclared entries and backend packages from the dictionary', async () => {
    await installEntries();
    const first = await buildCompressionDictionaries(pluginsRoot);
    const firstDictionary = dictionaryFor(first.dictionaries, 'remote-entry');
    await install(
      'a-undeclared',
      { 'remoteEntry.js': `${ENTRY_A}\n// unserved entry` },
      {
        declaredEntry: 'another-entry.js',
      },
    );
    await install(
      'b-backend',
      { 'remoteEntry.js': `${ENTRY_A}\n// backend entry` },
      {
        role: 'backend-plugin',
      },
    );
    const second = await buildCompressionDictionaries(pluginsRoot);
    const secondDictionary = dictionaryFor(second.dictionaries, 'remote-entry');
    expect(secondDictionary.url).toBe(firstDictionary.url);
    expect([...secondDictionary.bodies.keys()]).toEqual([
      ENTRY_A_PATH,
      ENTRY_B_PATH,
    ]);
  });

  it('does not preload a dictionary when the download outweighs the savings', async () => {
    await installEntries('export default 0;', 'export default 1;');
    await withServer(createApp(), async base => {
      const home = await request(base, '/');
      expect(home.headers.link).toBeUndefined();
      // The hashed URL of the tiny entry content, not of the default fixture.
      const tinyEntryB = `${REMOTES}${PLUGIN_B}/${hashedRemoteEntryName(
        Buffer.from('export default 1;'),
      )}`;
      expect((await request(base, tinyEntryB)).body.toString()).toBe(
        'export default 1;',
      );
    });
  });

  it('partitions one dictionary per asset class and routes each pattern', async () => {
    await installChunkFleet();
    const { dictionaries } = await buildCompressionDictionaries(pluginsRoot);
    // RFC 9842 §2.2.3: clients offer the longest matching pattern, so each
    // class gets its own dictionary and its own pattern.
    expect(dictionaries.map(d => d.classes)).toEqual([
      ['remote-entry'],
      ['expose-chunk'],
      ['sync-chunk'],
    ]);
    const [entryDictionary, exposeDictionary, syncDictionary] = dictionaries;
    expect(entryDictionary.match).toBe(`${REMOTES}*/remoteEntry*`);
    // Multi-wildcard pattern, verified in Chrome (see the probes).
    expect(exposeDictionary.match).toBe(
      `${REMOTES}*/static/__federation_expose_*`,
    );
    expect(syncDictionary.match).toBe(`${REMOTES}*/static/*`);
    expect(exposeDictionary.bodies.has(EXPOSE_A_URL)).toBe(true);
    expect(exposeDictionary.bodies.has(SYNC_B_URL)).toBe(false);
    expect(syncDictionary.bodies.has(SYNC_B_URL)).toBe(true);
    expect(syncDictionary.bodies.has(EXPOSE_A_URL)).toBe(false);
    expect(
      new Set([entryDictionary.url, exposeDictionary.url, syncDictionary.url])
        .size,
    ).toBe(3);

    await withServer(createApp(), async base => {
      expect(linkUrls((await request(base, '/')).headers.link).sort()).toEqual(
        [entryDictionary.url, exposeDictionary.url, syncDictionary.url].sort(),
      );

      // RFC 9842 §2.2: the client offers a single hash for its best
      // matching dictionary — here the sync dictionary (the only match).
      const chunk = await request(base, SYNC_B_URL, {
        'Accept-Encoding': 'gzip, dcz',
        'Available-Dictionary': `:${computeDictionaryHash(
          syncDictionary.raw,
        )}:`,
      });
      expect(chunk.headers['content-encoding']).toBe('dcz');
      expect(chunk.headers['cache-control']).toBe('public, max-age=1209600');
      expect(chunk.headers['x-content-type-options']).toBe('nosniff');
      expect(
        zlib
          .zstdDecompressSync(parseDczBody(chunk.body).zstdBody, {
            dictionary: syncDictionary.raw,
          })
          .toString(),
      ).toBe(`${modules}fetch("plugin://plugin-b/sync");`);

      const revalidated = await request(base, SYNC_B_URL, {
        ...offer(syncDictionary.raw),
        'If-None-Match': String(chunk.headers.etag),
      });
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers['content-encoding']).toBeUndefined();
      expect(revalidated.body).toHaveLength(0);

      // An expose chunk routes to the expose dictionary (longest match).
      const exposeChunk = await request(
        base,
        EXPOSE_A_URL,
        offer(exposeDictionary.raw),
      );
      expect(exposeChunk.headers['content-encoding']).toBe('dcz');
      expect(
        zlib
          .zstdDecompressSync(parseDczBody(exposeChunk.body).zstdBody, {
            dictionary: exposeDictionary.raw,
          })
          .toString(),
      ).toBe(`${modules}fetch("plugin://plugin-a/expose");`);

      // Async chunks are never in a corpus: the browser's offer of the
      // static dictionary is declined and they serve normally.
      const asyncChunk = await request(base, ASYNC_A_URL, {
        ...offer(syncDictionary.raw),
      });
      expect(asyncChunk.status).toBe(200);
      expect(asyncChunk.headers['content-encoding']).toBeUndefined();
      expect(asyncChunk.body.toString()).toBe(
        `${modules}fetch("plugin://plugin-a/async");`,
      );

      // A dictionary of the wrong pattern never matches another pattern URL.
      const wrongForChunk = await request(
        base,
        SYNC_B_URL,
        offer(entryDictionary.raw),
      );
      expect(wrongForChunk.headers['content-encoding']).toBeUndefined();
      const wrongForEntry = await request(
        base,
        ENTRY_B_PATH,
        offer(syncDictionary.raw),
      );
      expect(wrongForEntry.headers['content-encoding']).toBeUndefined();
    });
  });
});
