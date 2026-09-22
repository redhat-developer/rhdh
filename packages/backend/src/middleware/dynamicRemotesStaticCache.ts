import type { RequestHandler } from 'express';

/**
 * Same long-lived policy as `@backstage/plugin-app-backend` hashed `/static`
 * assets (`CACHE_CONTROL_MAX_CACHE`).
 */
export const DYNAMIC_REMOTES_STATIC_CACHE_CONTROL = 'public, max-age=1209600';

// Plugin dir may be unscoped (`pkg`) or scoped (`@scope/pkg`).
const DYNAMIC_REMOTES_STATIC_PATH =
  /^\/\.backstage\/dynamic-features\/remotes\/(?:@[^/]+\/)?[^/]+\/static\//;

/**
 * Sets aggressive Cache-Control for hashed Module Federation remote chunks
 * under `/.backstage/dynamic-features/remotes/<plugin>/static/`.
 *
 * Upstream `@backstage/backend-dynamic-feature-service` serves remotes with
 * bare `express.static`, which defaults to `public, max-age=0`. The `send`
 * package only sets Cache-Control when the header is not already present, so
 * registering this middleware before root routes lets that stronger policy
 * stick. `remoteEntry.js` / `mf-manifest.json` are intentionally untouched.
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
  }
  next();
};
