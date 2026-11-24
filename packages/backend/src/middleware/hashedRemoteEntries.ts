import type { RequestHandler } from 'express';

import {
  HASHED_REMOTE_ENTRY_PATH_RE,
  lookupRemoteEntry,
} from '../modules/dynamicFeaturesPreload/remoteEntryRegistry';

/** Cache-Control for content-addressed remote entries. */
export const HASHED_REMOTE_ENTRY_CACHE_CONTROL =
  'public, max-age=31536000, immutable';

const NOT_FOUND_BODY = 'Hashed remote entry not found';

/**
 * Serve content-hashed dynamic plugin remote entries
 * (`/.backstage/dynamic-features/remotes/<plugin>/remoteEntry.<16 hex>.js`)
 * from the in-memory remote-entry registry.
 *
 * The URL is content-addressed by construction (the hash is derived
 * from the bytes at registration and the registry is the only source),
 * so it is served immutable: a warm navigation needs zero network
 * requests for entries instead of one revalidation per plugin. A stale
 * hash (plugin upgraded, old page still cached) is a loud 404 with
 * `no-store`, never different bytes at the same immutable URL.
 *
 * Responses carry precomputed brotli/gzip encodings when accepted: this
 * middleware runs before the root stack's `compression()` middleware
 * and terminal-returns, so it must encode itself. `Vary:
 * Accept-Encoding` is always set for CDN correctness.
 *
 * Everything that does not match the hashed-entry URL shape —
 * including the literal `remoteEntry.js` (kept revalidating as the
 * fallback path) and `mf-manifest.json` — falls through to `next()`.
 *
 * The registry is a module-scoped singleton populated during the
 * dynamic-features resolver's startup hooks; requests only arrive
 * after startup completes, so it is fully populated by then.
 *
 * Note: a dynamic plugin that fully replaces `core.rootHttpRouter`
 * (via `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE`) must re-include this
 * middleware to keep the same behavior. The dynamic-features resolver
 * detects that env var and degrades to the literal `remoteEntry.js`
 * names, so hashed URLs are never referenced when this middleware is
 * absent.
 */
export function hashedRemoteEntriesMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const match = HASHED_REMOTE_ENTRY_PATH_RE.exec(req.path);
    if (!match) {
      next();
      return;
    }
    const [, pluginName, hash] = match;

    const record = lookupRemoteEntry(pluginName, hash);
    if (!record) {
      res.status(404);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(NOT_FOUND_BODY));
      res.end(NOT_FOUND_BODY);
      return;
    }

    // Precomputed encodings: prefer brotli, then gzip, then identity.
    const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
    let body = record.bytes;
    let encoding: string | undefined;
    if (acceptEncoding.includes('br')) {
      body = record.brotli;
      encoding = 'br';
    } else if (acceptEncoding.includes('gzip')) {
      body = record.gzip;
      encoding = 'gzip';
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', HASHED_REMOTE_ENTRY_CACHE_CONTROL);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (encoding) {
      res.setHeader('Content-Encoding', encoding);
    }
    // No ETag — the immutable policy means a conforming client never
    // revalidates. res.end skips Express's res.send ETag generation and
    // suppresses the body for HEAD requests (Node does that natively).
    res.setHeader('Content-Length', body.length);
    res.end(body);
  };
}
