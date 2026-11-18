import type { RequestHandler } from 'express';

/**
 * Same long-lived policy as `@backstage/plugin-app-backend` hashed `/static`
 * assets (`CACHE_CONTROL_MAX_CACHE`).
 */
export const DYNAMIC_REMOTES_STATIC_CACHE_CONTROL = 'public, max-age=1209600';

/**
 * Revalidation-safe policy for unhashed Module Federation entrypoints.
 * Browsers may store the response but must revalidate (typically via ETag
 * from `express.static` / `send`) before reuse — avoids stale `remoteEntry.js`
 * after a plugin upgrade while still enabling 304s on warm loads.
 */
export const DYNAMIC_REMOTES_ENTRY_CACHE_CONTROL = 'no-cache';

// Plugin dir may be unscoped (`pkg`) or scoped (`@scope/pkg`).
const DYNAMIC_REMOTES_STATIC_PATH =
  /^\/\.backstage\/dynamic-features\/remotes\/(?:@[^/]+\/)?[^/]+\/static\//;

const DYNAMIC_REMOTES_ENTRY_PATH =
  /^\/\.backstage\/dynamic-features\/remotes\/(?:@[^/]+\/)?[^/]+\/(?:remoteEntry\.js|mf-manifest\.json)$/;

/**
 * Sets Cache-Control for Module Federation remotes under
 * `/.backstage/dynamic-features/remotes/<plugin>/`:
 *
 * - Hashed `/static/` chunks → long-lived `max-age` (content-addressed).
 * - Unhashed `remoteEntry.js` / `mf-manifest.json` → `no-cache` so clients
 *   revalidate (ETag from `express.static` / `send`). Do **not** use long
 *   immutable max-age here: entry URLs are not content-hashed.
 *
 * Upstream `@backstage/backend-dynamic-feature-service` serves remotes with
 * bare `express.static`, which defaults to `public, max-age=0`. The `send`
 * package only sets Cache-Control when the header is not already present, so
 * registering this middleware before root routes lets that stronger policy
 * stick.
 *
 * Note: a dynamic plugin that fully replaces `core.rootHttpRouter` (via
 * `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE`) must re-include this middleware to
 * keep the same behavior.
 */
export const dynamicRemotesStaticCacheMiddleware: RequestHandler = (
  req,
  res,
  next,
) => {
  if (DYNAMIC_REMOTES_STATIC_PATH.test(req.path)) {
    res.setHeader('Cache-Control', DYNAMIC_REMOTES_STATIC_CACHE_CONTROL);
  } else if (DYNAMIC_REMOTES_ENTRY_PATH.test(req.path)) {
    res.setHeader('Cache-Control', DYNAMIC_REMOTES_ENTRY_CACHE_CONTROL);
  }
  next();
};
