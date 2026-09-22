/**
 * HTTP path constants for Backstage dynamic frontend features and the
 * RHDH preload endpoint.
 *
 * Owned by the backend dynamic-features preload module — the same place that
 * mounts these routes and generates `preload.js`.
 *
 * `DYNAMIC_FEATURES_PLUGIN_ID` mirrors the internal plugin id used by
 * `@backstage/frontend-dynamic-feature-loader` /
 * `@backstage/backend-dynamic-feature-service` (not a public API export).
 *
 * `packages/app/public/index.html` must keep its `<script defer src=...>`
 * in sync with {@link DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}.
 */

/** Upstream dynamic-features service plugin id (no leading slash). */
export const DYNAMIC_FEATURES_PLUGIN_ID = '.backstage/dynamic-features';

/**
 * Absolute URL path of GET remotes.
 * Embedded in `preload.js` so the fetch shim can intercept that request.
 */
export const DYNAMIC_FEATURES_REMOTES_PATH = `/${DYNAMIC_FEATURES_PLUGIN_ID}/remotes`;

/** Mount path for the RHDH preload HTTP endpoint. */
export const DYNAMIC_FEATURES_PRELOAD_BASE_PATH =
  '/.backstage/dynamic-features-preload';

/**
 * Absolute URL path of the preload script.
 * Must stay in sync with `packages/app/public/index.html`.
 */
export const DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH = `${DYNAMIC_FEATURES_PRELOAD_BASE_PATH}/preload.js`;

/** Default Module Federation manifest filename under each remote. */
export const DYNAMIC_FEATURES_MANIFEST_FILE = 'mf-manifest.json';
