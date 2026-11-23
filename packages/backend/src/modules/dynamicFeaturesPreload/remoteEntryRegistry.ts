import type { LoggerService } from '@backstage/backend-plugin-api';

import fs from 'node:fs';
import path from 'node:path';
import {
  brotliCompressSync,
  gzipSync,
  constants as zlibConstants,
} from 'node:zlib';

import { hashedRemoteEntryName } from './remoteEntryHash';

/**
 * A registered remote entry: the content-addressed name plus the bytes
 * it was computed from and their precomputed encodings.
 */
export interface RemoteEntryRecord {
  /** `remoteEntry.<16 hex>.js` — derived from `bytes`. */
  hashedName: string;
  /** The exact entry bytes served at the hashed URL. */
  bytes: Buffer;
  /** Brotli (quality 9) of `bytes`, computed once at registration. */
  brotli: Buffer;
  /** Gzip (level 9) of `bytes`, computed once at registration. */
  gzip: Buffer;
}

/**
 * Registry of content-hashed remote entries, keyed by plugin name.
 *
 * Lifecycle: populated during the dynamic-features resolver's `for()`
 * hooks (upstream startup); read only by the hashed-entries request
 * handler. HTTP requests only arrive after all startup hooks complete
 * (the same guarantee the `PreloadStore` relies on), so handlers never
 * observe a partially populated registry.
 *
 * This map is a module-scoped singleton because its reader is a global
 * middleware created at `rootHttpRouterServiceFactory.configure()`
 * time — before the resolver plugin initializes — and Express
 * middlewares cannot receive services. Registration still goes through
 * {@link registerRemoteEntry} with an explicit registry argument so
 * tests can use isolated instances.
 */
export type RemoteEntryRegistry = Map<string, RemoteEntryRecord>;

/** The singleton registry read by the serving middleware. */
export const remoteEntryRegistry: RemoteEntryRegistry = new Map();

/**
 * URL shape of a hashed remote entry:
 * `/.backstage/dynamic-features/remotes/<plugin>/remoteEntry.<16 hex>.js`.
 *
 * The plugin segment is a greedy `.+` so scoped `@scope/pkg` names
 * match; the 16-hex segment must be lowercase. The literal
 * `remoteEntry.js` and `mf-manifest.json` do not match (no hex
 * segment), so those URLs keep flowing to the upstream static router.
 */
export const HASHED_REMOTE_ENTRY_PATH_RE =
  /^\/\.backstage\/dynamic-features\/remotes\/(.+)\/remoteEntry\.([0-9a-f]{16})\.js$/;

/**
 * Register one plugin's `dist/remoteEntry.js` in the registry.
 *
 * Reads the entry bytes, derives the content-addressed name, and
 * precomputes the brotli/gzip encodings — everything the serving
 * middleware needs to answer with zero per-request work.
 *
 * Degradation is graceful and logged: a missing or unreadable entry
 * leaves the plugin unregistered (the resolver then serves and
 * references the literal `remoteEntry.js`, exactly the pre-hashing
 * behavior), and a second registration for the same plugin name keeps
 * the first copy and warns.
 */
export function registerRemoteEntry(
  registry: RemoteEntryRegistry,
  pluginName: string,
  pluginPackagePath: string,
  logger: LoggerService,
): void {
  if (registry.has(pluginName)) {
    logger.warn(
      `dynamic-features-resolver: remote entry for '${pluginName}' already registered; keeping the first registration`,
    );
    return;
  }

  const entryPath = path.join(pluginPackagePath, 'dist', 'remoteEntry.js');
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(entryPath);
  } catch (error) {
    logger.warn(
      `dynamic-features-resolver: could not read remote entry '${entryPath}' for '${pluginName}': ${error}. Falling back to the literal remoteEntry.js name for this plugin.`,
    );
    return;
  }

  const hashedName = hashedRemoteEntryName(bytes);
  registry.set(pluginName, {
    hashedName,
    bytes,
    brotli: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
    }),
    gzip: gzipSync(bytes, { level: 9 }),
  });
}

/**
 * Look up a plugin's registered entry by name and hash.
 *
 * Returns the record only when both the plugin is registered and the
 * requested hash matches its content hash — an unknown plugin or a
 * stale/wrong hash is a miss, so the serving middleware can answer
 * with a loud 404 instead of wrong bytes carrying an immutable policy.
 */
export function lookupRemoteEntry(
  pluginName: string,
  hash: string,
): RemoteEntryRecord | undefined {
  const record = remoteEntryRegistry.get(pluginName);
  if (!record) {
    return undefined;
  }
  return record.hashedName === `remoteEntry.${hash}.js` ? record : undefined;
}
