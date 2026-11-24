import type { RequestHandler } from 'express';

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { hashedRemoteEntryName } from '../modules/dynamicFeaturesPreload/remoteEntryHash';
import { DYNAMIC_REMOTES_STATIC_CACHE_CONTROL } from './dynamicRemotesStaticCache';

/**
 * Compression Dictionary Transport (Chrome 130+, Firefox 162+) for the Module
 * Federation remote assets under `/.backstage/dynamic-features/remotes/`.
 *
 * One parametrized, fully precomputed server-side algorithm covers every
 * category of JavaScript remote assets that is fetched on the critical
 * path:
 *
 * - `remote-entry` — each plugin's declared public `remoteEntry.js`;
 * - `expose-chunk` — the `__federation_expose_*` chunk of every exposed
 *   remote module;
 * - `sync-chunk` — the chunks each `mf-manifest.json` lists under
 *   `exposes[].assets.js.sync`.
 *
 * The `assets.js.async` chunks are deliberately not covered: browsers fetch
 * none of them on a cold load, and including their (highly-shared) content
 * would dilute the sync dictionary's budget. Async requests still offer the
 * static dictionary — the offer is simply declined and they serve normally.
 *
 * Asset categories are parameters of the same pipeline: corpus scan with
 * per-class caps, content-defined-chunking dictionary construction within a
 * byte budget, and precomputed dcz bodies that are stored only where they
 * beat the file's normal Brotli encoding. One dictionary is emitted per
 * asset class, each with its own match pattern (RFC 9842 §2.2.3: clients
 * offer the longest matching pattern, so the patterns route every URL
 * deterministically). Each emitted dictionary is content-addressed,
 * bounded, advertised through a document Link preload, and only served when
 * it pays for itself. Nothing is added at runtime: there is no lazy capture
 * and no runtime-created dictionary.
 *
 * Normal serving remains available if the client has no matching dictionary.
 * The direct responses below run before the downstream HTTP middleware.
 * Note: a dynamic plugin that fully replaces `core.rootHttpRouter` (via
 * `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE`) must re-include this middleware to
 * keep the same behavior.
 */

const DYNAMIC_REMOTES_PATH_PREFIX = '/.backstage/dynamic-features/remotes/';
const REMOTE_ENTRY_FILENAME = 'remoteEntry.js';
// Matches both the content-hashed entry URLs served by
// hashedRemoteEntriesMiddleware and the literal fallback URL; the two
// wildcards are spec-legal URLPattern full wildcards (RFC 9842 §2.1.1).
const REMOTE_ENTRY_MATCH = `${DYNAMIC_REMOTES_PATH_PREFIX}*/remoteEntry*`;
const HASHED_REMOTE_ENTRY_PATTERN = /\/remoteEntry\.[0-9a-f]{16}\.js$/;
const EXPOSE_CHUNK_MATCH = `${DYNAMIC_REMOTES_PATH_PREFIX}*/static/__federation_expose_*`;
const STATIC_CHUNK_MATCH = `${DYNAMIC_REMOTES_PATH_PREFIX}*/static/*`;

const DICTIONARIES_PATH_PREFIX = '/.backstage/dynamic-features/dictionaries/';
const DICTIONARY_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const VARY = 'Accept-Encoding, Available-Dictionary';

/** Largest single corpus member. */
const MAX_CORPUS_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Corpus byte caps per asset class. A class whose members exceed its cap
 * (or that sees the same URL from two different plugin installs — an
 * ambiguous corpus) contributes nothing at all: an incomplete corpus could
 * build a dictionary that pays for the wrong URLs.
 */
const MAX_CORPUS_BYTES_PER_CLASS = {
  'remote-entry': 32 * 1024 * 1024,
  'expose-chunk': 32 * 1024 * 1024,
  'sync-chunk': 32 * 1024 * 1024,
} satisfies Record<CompressionDictionaryAssetClass, number>;

// Tuned on an 80-plugin testbed fleet (see the testbed evaluation): the
// per-pattern budget saturates around 4 MiB of shared content.
const DEFAULT_DICTIONARY_BUDGET_BYTES = 4 * 1024 * 1024;
const DEFAULT_TARGET_BLOCK_SIZE = 1024;
/**
 * Blocks shared by more members rank first regardless; the measured optimum
 * (dictlab benchmark, and the entry-only dictionary this replaces) also lets
 * single-member blocks claim leftover budget — they still compress the one
 * member that contains them.
 */
const DEFAULT_MIN_SHARED_MEMBERS = 1;
const DEFAULT_BODY_COMPRESSION_LEVEL = 14;

/**
 * The categories of JavaScript remote assets the pipeline covers. All
 * categories run through the same scan, dictionary builder and serving
 * path; they differ only by include predicate, corpus cap and
 * `Use-As-Dictionary` match pattern.
 */
export type CompressionDictionaryAssetClass =
  'remote-entry' | 'expose-chunk' | 'sync-chunk';

const ASSET_CLASSES: CompressionDictionaryAssetClass[] = [
  'remote-entry',
  'expose-chunk',
  'sync-chunk',
];

const DEFAULT_ASSET_CLASSES: CompressionDictionaryAssetClass[] = [
  'remote-entry',
  'expose-chunk',
  'sync-chunk',
];

export interface CompressionDictionaryMiddlewareOptions {
  /**
   * Asset categories included in dictionary construction. Default: every
   * category (`remote-entry`, `expose-chunk`, `sync-chunk`).
   */
  assetClasses?: CompressionDictionaryAssetClass[];
  /** Dictionary budget in bytes, per emitted dictionary. Default 4 MiB. */
  dictionaryBudgetBytes?: number;
  /** Content-defined chunking target block size. Default 1024. */
  targetBlockSize?: number;
  /**
   * Minimum number of corpus members a block must appear in to enter the
   * dictionary. Default 1 — blocks shared by more members always rank first,
   * and leftover budget is measured to pay off on single-member blocks too.
   */
  minSharedMembers?: number;
  /** zstd compression level for precomputed dcz bodies. Default 14. */
  bodyCompressionLevel?: number;
  /**
   * Directory containing the installed dynamic plugins (the
   * `dynamicPlugins.rootDirectory` value). Used to build the dictionaries at
   * startup.
   */
  pluginsRootDirectory?: string;
}

/**
 * A dictionary emitted at startup by the unified pipeline. `bodies` holds a
 * precomputed dcz response per covered URL — only where it is smaller than
 * the file's normal Brotli encoding.
 */
export interface CompressionDictionary {
  /** Content-addressed serving path. */
  url: string;
  /** SHA-256 of the dictionary bytes, base64 (unpadded `Available-Dictionary` form). */
  hash: string;
  /** `Use-As-Dictionary` match pattern for the covered URLs. */
  match: string;
  /** Asset classes whose members the dictionary was built from. */
  classes: CompressionDictionaryAssetClass[];
  raw: Buffer;
  brotli: Buffer;
  gzip: Buffer;
  bodies: Map<string, Buffer>;
}

/** Result of the dynamic plugins root scan. */
export interface PluginsRootScan {
  dictionaries: CompressionDictionary[];
}

interface DictionaryBuildOptions {
  budgetBytes: number;
  targetBlockSize: number;
  minSharedMembers: number;
  bodyCompressionLevel: number;
}

/**
 * SHA-256 of the dictionary bytes, base64-encoded — the unpadded form of the
 * `Available-Dictionary` request header value.
 */
export function computeDictionaryHash(dictionary: Buffer): string {
  return createHash('sha256').update(dictionary).digest('base64');
}

/**
 * Browsers pad `Available-Dictionary` with `:` characters at randomized
 * positions (anti-fingerprinting); strip them before comparing.
 */
export function normalizeDictionaryHash(value: string): string {
  return value.replace(/:/g, '');
}

/** RFC 9842 §5 dcz stream magic (zstd skippable frame, little-endian). */
const DCZ_MAGIC = Buffer.from([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);

// A rolling gear hash gives content-defined boundaries that resynchronize
// after local changes, e.g. an entry's embedded plugin name changing length.
const gear = Array.from({ length: 256 }, (_, byte) => {
  let hash = Math.imul(byte + 1, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  return hash ^ (hash >>> 15);
});

function matchPatternFor(assetClass: CompressionDictionaryAssetClass): string {
  if (assetClass === 'remote-entry') return REMOTE_ENTRY_MATCH;
  if (assetClass === 'expose-chunk') return EXPOSE_CHUNK_MATCH;
  return STATIC_CHUNK_MATCH;
}

/**
 * Cache policy for dictionary-compressed entry responses: hashed entry
 * URLs are content-addressed and cache immutable (matching
 * hashedRemoteEntriesMiddleware); the literal fallback entry URL keeps
 * revalidating.
 */
function entryCacheControl(urlPath: string): string {
  return HASHED_REMOTE_ENTRY_PATTERN.test(urlPath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0';
}

function dictionaryNameFor(classes: CompressionDictionaryAssetClass[]): string {
  if (classes.length === 1) return classes[0];
  return 'remotes';
}

/**
 * The dictionary construction step shared by every asset class and partition:
 * content-defined chunking of the corpus, block ranking by the number of
 * distinct members containing each block, budget-constrained selection
 * restored to source order (to preserve long zstd matches), then precomputed
 * dcz bodies and the first-load savings gate.
 */
function buildDictionary(
  members: Map<string, Buffer>,
  classes: CompressionDictionaryAssetClass[],
  options: DictionaryBuildOptions,
): CompressionDictionary | undefined {
  if (members.size < 2) return undefined;

  const targetBlockSize = options.targetBlockSize;
  const blocks = new Map<
    string,
    { bytes: Buffer; order: number; memberCount: number; lastMember: number }
  >();
  for (const [member, bytes] of [...members.values()].entries()) {
    let hash = 0;
    let start = 0;
    for (let end = 1; end <= bytes.length; end++) {
      hash = (hash << 1) + gear[bytes[end - 1]];
      const length = end - start;
      if (
        end < bytes.length &&
        (length < targetBlockSize / 4 ||
          (length < 4 * targetBlockSize &&
            (hash & (targetBlockSize - 1)) !== 0))
      ) {
        continue;
      }
      const block = bytes.subarray(start, end);
      // Latin-1 keeps the key byte-exact, including non-ASCII plugin sources.
      const key = block.toString('latin1');
      const existing = blocks.get(key);
      if (!existing) {
        blocks.set(key, {
          bytes: block,
          order: blocks.size,
          memberCount: 1,
          lastMember: member,
        });
      } else if (existing.lastMember !== member) {
        existing.memberCount++;
        existing.lastMember = member;
      }
      start = end;
      hash = 0;
    }
  }

  let size = 0;
  // Give blocks shared by more members first claim on the budget, then
  // restore source order to preserve long matches across adjacent blocks.
  const selected = [...blocks.values()]
    .filter(block => block.memberCount >= options.minSharedMembers)
    .sort((a, b) => b.memberCount - a.memberCount || a.order - b.order)
    .filter(block => {
      if (size + block.bytes.length > options.budgetBytes) return false;
      size += block.bytes.length;
      return true;
    })
    .sort((a, b) => a.order - b.order);
  const raw = Buffer.concat(
    selected.map(block => block.bytes),
    size,
  );
  // Node's encoder detects formatted Zstd dictionaries by magic. CDT always
  // uses raw bytes, so do not feed an ambiguous prefix to the encoder.
  if (raw.length < 8 || raw.readUInt32LE(0) === 0xec30a437) return undefined;

  const brotli = zlib.brotliCompressSync(raw, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const digest = createHash('sha256').update(raw).digest();
  const bodies = new Map<string, Buffer>();
  let firstLoadBytes = brotli.length;
  let baselineBytes = 0;
  for (const [url, bytes] of members) {
    // Compare against the normal per-file Brotli encoding (quality 4).
    const baseline = zlib.brotliCompressSync(bytes, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    }).length;
    const dcz = buildDczBody(
      zlib.zstdCompressSync(bytes, {
        dictionary: raw,
        params: {
          [zlib.constants.ZSTD_c_compressionLevel]:
            options.bodyCompressionLevel,
        },
      }),
      digest,
    );
    if (dcz.length < baseline) bodies.set(url, dcz);
    firstLoadBytes += Math.min(dcz.length, baseline);
    baselineBytes += baseline;
  }
  if (firstLoadBytes >= baselineBytes) return undefined;

  return {
    url: `${DICTIONARIES_PATH_PREFIX}${dictionaryNameFor(classes)}-${digest.toString('hex')}.dat`,
    hash: digest.toString('base64'),
    match: matchPatternFor(classes[0]),
    classes,
    raw,
    brotli,
    gzip: zlib.gzipSync(raw),
    bodies,
  };
}

interface MfManifest {
  name?: string;
  exposes?: {
    name?: string;
    assets?: { js?: { sync?: unknown } };
  }[];
  metaData?: { remoteEntry?: { name?: string; path?: string } };
}

/**
 * Scans a dynamic plugins root and builds the precomputed dictionaries for
 * the requested asset classes — the single pipeline every category runs
 * through. Per class, the corpus is capped and must be unambiguous (no URL
 * claimed by two plugin installs); a class that violates either contributes
 * nothing. Plugins contribute only what their `mf-manifest.json` declares:
 * the public remote entry and the chunk files listed under `exposes[]`.
 */
export async function buildCompressionDictionaries(
  pluginsRootDirectory: string,
  options: CompressionDictionaryMiddlewareOptions = {},
): Promise<PluginsRootScan> {
  const assetClasses = new Set(options.assetClasses ?? DEFAULT_ASSET_CLASSES);
  const buildOptions: DictionaryBuildOptions = {
    budgetBytes:
      options.dictionaryBudgetBytes ?? DEFAULT_DICTIONARY_BUDGET_BYTES,
    targetBlockSize: options.targetBlockSize ?? DEFAULT_TARGET_BLOCK_SIZE,
    minSharedMembers: options.minSharedMembers ?? DEFAULT_MIN_SHARED_MEMBERS,
    bodyCompressionLevel:
      options.bodyCompressionLevel ?? DEFAULT_BODY_COMPRESSION_LEVEL,
  };

  const members = new Map<
    CompressionDictionaryAssetClass,
    Map<string, Buffer>
  >();
  const memberInstall = new Map<string, string>();
  const classBytes = new Map<CompressionDictionaryAssetClass, number>();
  const abortedClasses = new Set<CompressionDictionaryAssetClass>();

  const addMember = async (
    assetClass: CompressionDictionaryAssetClass,
    url: string,
    filePath: string,
    pluginDir: string,
  ) => {
    if (!assetClasses.has(assetClass) || abortedClasses.has(assetClass)) {
      return;
    }
    const seenInstall = memberInstall.get(url);
    if (seenInstall === pluginDir) return;
    if (seenInstall !== undefined) {
      // Two installs claim the same URL: the corpus is ambiguous.
      abortedClasses.add(assetClass);
      members.get(assetClass)?.clear();
      return;
    }
    let stat;
    try {
      stat = await fs.lstat(filePath);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > MAX_CORPUS_FILE_BYTES) return;
    const bytes = classBytes.get(assetClass) ?? 0;
    if (bytes + stat.size > MAX_CORPUS_BYTES_PER_CLASS[assetClass]) {
      abortedClasses.add(assetClass);
      members.get(assetClass)?.clear();
      return;
    }
    try {
      const content = await fs.readFile(filePath);
      if (!members.has(assetClass)) members.set(assetClass, new Map());
      members.get(assetClass)!.set(url, content);
      memberInstall.set(url, pluginDir);
      classBytes.set(assetClass, bytes + stat.size);
    } catch {
      // Unreadable assets serve normally.
    }
  };

  let pluginDirs: string[];
  try {
    pluginDirs = (
      await fs.readdir(pluginsRootDirectory, { withFileTypes: true })
    )
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    return { dictionaries: [] };
  }
  for (const pluginDir of pluginDirs) {
    const pluginRoot = path.join(pluginsRootDirectory, pluginDir);
    let packageName: string | undefined;
    let isFrontend = false;
    try {
      // eslint-disable-next-line no-restricted-syntax
      const pkg = JSON.parse(
        await fs.readFile(path.join(pluginRoot, 'package.json'), 'utf8'),
      ) as { name?: string; main?: string; backstage?: { role?: string } };
      packageName = pkg.name;
      isFrontend =
        typeof pkg.main === 'string' &&
        [
          'frontend-plugin',
          'frontend-plugin-module',
          'frontend-dynamic-container',
        ].includes(pkg.backstage?.role ?? '');
    } catch {
      continue;
    }
    if (typeof packageName !== 'string' || !packageName || !isFrontend) {
      continue;
    }
    const distDir = path.join(pluginRoot, 'dist');
    let manifest: MfManifest;
    try {
      // eslint-disable-next-line no-restricted-syntax
      manifest = JSON.parse(
        await fs.readFile(path.join(distDir, 'mf-manifest.json'), 'utf8'),
      ) as MfManifest;
    } catch {
      // Missing, unreadable or malformed remote assets serve normally.
      continue;
    }

    // Only include the declared, public remote entry, not other package
    // data. An entry does not need to ship a static chunk directory.
    // Browsers request the content-hashed entry URL (the resolver rewrites
    // metaData.remoteEntry.name at serving time), so the corpus member is
    // keyed by the same hashed name; the literal fallback URL keeps normal
    // serving.
    const remote = manifest.metaData?.remoteEntry;
    if (
      typeof manifest.name === 'string' &&
      manifest.name &&
      Array.isArray(manifest.exposes) &&
      manifest.exposes.every(exposure => typeof exposure?.name === 'string') &&
      remote?.name === REMOTE_ENTRY_FILENAME &&
      !remote.path
    ) {
      const entryPath = path.join(distDir, REMOTE_ENTRY_FILENAME);
      try {
        const entryBytes = await fs.readFile(entryPath);
        await addMember(
          'remote-entry',
          `${DYNAMIC_REMOTES_PATH_PREFIX}${packageName}/${hashedRemoteEntryName(entryBytes)}`,
          entryPath,
          pluginDir,
        );
      } catch {
        // Unreadable entries serve normally.
      }
    }

    // Chunk classes come from the manifest's sync lists: exactly the files
    // Module Federation loads with the exposed modules. Subdirectories
    // (`static/react-syntax-highlighter/…`) are allowed; anything escaping
    // the dist directory is not. The async lists are deliberately skipped —
    // those chunks are never fetched on a cold load.
    const exposures = Array.isArray(manifest.exposes) ? manifest.exposes : [];
    for (const exposure of exposures) {
      const syncAssets = exposure?.assets?.js?.sync;
      if (!Array.isArray(syncAssets)) continue;
      for (const file of syncAssets) {
        if (typeof file !== 'string') continue;
        const relative = file.replace(/^\.\//, '');
        if (!relative || relative.includes('..') || path.isAbsolute(relative)) {
          continue;
        }
        const filePath = path.join(distDir, relative);
        if (!filePath.startsWith(`${distDir}${path.sep}`)) continue;
        // Expose chunks are a distinct class even though they are listed
        // in the sync assets; first classification of a URL wins.
        const assetClass: CompressionDictionaryAssetClass = path.posix
          .basename(relative)
          .startsWith('__federation_expose_')
          ? 'expose-chunk'
          : 'sync-chunk';
        await addMember(
          assetClass,
          `${DYNAMIC_REMOTES_PATH_PREFIX}${packageName}/${relative}`,
          filePath,
          pluginDir,
        );
      }
    }
  }

  const presentClasses = ASSET_CLASSES.filter(
    assetClass => (members.get(assetClass)?.size ?? 0) > 0,
  );
  // One dictionary per asset class. Each class has its own match pattern,
  // and RFC 9842 §2.2.3 makes clients offer the longest matching pattern,
  // so expose URLs route to the expose dictionary and the remaining static
  // URLs to the sync dictionary deterministically.
  const dictionaries = presentClasses
    .map(assetClass =>
      buildDictionary(
        members.get(assetClass) ?? new Map<string, Buffer>(),
        [assetClass],
        buildOptions,
      ),
    )
    .filter(
      (dictionary): dictionary is CompressionDictionary =>
        dictionary !== undefined,
    );
  return { dictionaries };
}

export function createCompressionDictionaryMiddleware(
  options: CompressionDictionaryMiddlewareOptions = {},
): RequestHandler {
  const scan: Promise<CompressionDictionary[]> = options.pluginsRootDirectory
    ? buildCompressionDictionaries(options.pluginsRootDirectory, options)
        .then(result => result.dictionaries)
        .catch(() => [])
    : Promise.resolve([]);

  return (req, res, next) => {
    const isRemotes = req.path.startsWith(DYNAMIC_REMOTES_PATH_PREFIX);
    const isEntry =
      isRemotes &&
      (req.path.endsWith(`/${REMOTE_ENTRY_FILENAME}`) ||
        HASHED_REMOTE_ENTRY_PATTERN.test(req.path));
    const isChunk = isRemotes && !isEntry && req.path.includes('/static/');
    const isDictionary = req.path.startsWith(DICTIONARIES_PATH_PREFIX);
    const isDocument =
      req.method === 'GET' &&
      req.accepts('html') &&
      (req.path === '/' ||
        (path.extname(req.path) === '' &&
          !req.path.startsWith('/api/') &&
          !req.path.startsWith('/.backstage/') &&
          !req.path.startsWith('/static/')));
    if (
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      (!isEntry && !isChunk && !isDictionary && !isDocument)
    ) {
      next();
      return;
    }

    void (async () => {
      const dictionaries = await scan;

      if (isDictionary) {
        const dictionary = dictionaries.find(d => d.url === req.path);
        if (!dictionary) {
          res.setHeader('Cache-Control', 'no-store');
          res.status(404).end();
          return;
        }
        res.vary('Accept-Encoding');
        const encoding =
          req.acceptsEncodings('br') ||
          req.acceptsEncodings('gzip', 'identity');
        if (!encoding) {
          res.status(406).end();
          return;
        }
        res.setHeader('Use-As-Dictionary', `match="${dictionary.match}"`);
        res.setHeader('Cache-Control', DICTIONARY_CACHE_CONTROL);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.type('application/octet-stream');
        if (encoding !== 'identity')
          res.setHeader('Content-Encoding', encoding);
        let body = dictionary.raw;
        if (encoding === 'br') body = dictionary.brotli;
        if (encoding === 'gzip') body = dictionary.gzip;
        res.send(body);
        return;
      }

      // The dictionary-specific link relation can fetch too late for the
      // first module imports. Preload it as an ordinary same-origin fetch.
      if (isDocument) {
        for (const dictionary of dictionaries) {
          res.append(
            'Link',
            `<${dictionary.url}>; rel=preload; as=fetch; fetchpriority="high"`,
          );
        }
      }

      if (isEntry || isChunk) {
        const classActive = isEntry
          ? dictionaries.some(d => d.classes.includes('remote-entry'))
          : dictionaries.some(d => d.classes.some(c => c !== 'remote-entry'));
        if (classActive) {
          res.vary(VARY);
        }
      }

      // RFC 9842 §2.2: the client sends a single Available-Dictionary hash
      // for its best matching dictionary (longest match wins, §2.2.3).
      const offeredHash =
        typeof req.headers['available-dictionary'] === 'string' &&
        req.headers.range === undefined &&
        req.acceptsEncodings('dcz')
          ? normalizeDictionaryHash(req.headers['available-dictionary'])
          : undefined;
      const dcz = offeredHash
        ? dictionaries
            .find(dictionary => dictionary.hash === offeredHash)
            ?.bodies.get(req.path)
        : undefined;

      if (dcz) {
        res.setHeader(
          'Cache-Control',
          isEntry
            ? entryCacheControl(req.path)
            : DYNAMIC_REMOTES_STATIC_CACHE_CONTROL,
        );
        res.setHeader(
          'ETag',
          `"${createHash('sha256').update(dcz).digest('hex')}"`,
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // Do not trigger Chrome's dcz decoder on a bodyless 304.
        if (req.fresh) {
          res.status(304).end();
          return;
        }
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Content-Encoding', 'dcz');
        res.send(dcz);
        return;
      }
      next();
    })().catch(() => {
      next();
    });
  };
}

/**
 * RFC 9842 §5 (dcz): the response body is a 40-byte fixed header followed
 * by a zstd stream compressed with the external dictionary. The header is a
 * zstd skippable frame (little-endian magic 0x184d2a5e, length 0x20)
 * carrying the raw 32-byte SHA-256 digest of the dictionary, letting the
 * client confirm the dictionary it offered is the one that was used.
 */
function buildDczBody(zstdBody: Buffer, dictionaryDigest: Buffer): Buffer {
  return Buffer.concat([DCZ_MAGIC, dictionaryDigest, zstdBody]);
}

/**
 * Splits a dcz response body (RFC 9842 §5) into its 32-byte dictionary
 * digest and the zstd stream; validates the skippable-frame magic.
 */
export function parseDczBody(body: Buffer): {
  dictionaryDigest: Buffer;
  zstdBody: Buffer;
} {
  if (body.length < 40 || !body.subarray(0, 8).equals(DCZ_MAGIC)) {
    throw new Error('not a dcz stream: bad skippable-frame header');
  }
  return {
    dictionaryDigest: body.subarray(8, 40),
    zstdBody: body.subarray(40),
  };
}
