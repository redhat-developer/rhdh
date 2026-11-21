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

/**
 * Root-relative path to a plugin's Module Federation manifest.
 *
 * Prefer `/…` over `${backend.baseUrl}/…` in preload.js / remotes data so
 * the payload stays smaller and same-origin browser resolution works
 * without baking the hostname into hundreds of snapshot entries.
 */
export function dynamicFeaturesRemoteManifestPath(pluginName: string): string {
  return `${DYNAMIC_FEATURES_REMOTES_PATH}/${pluginName}/${DYNAMIC_FEATURES_MANIFEST_FILE}`;
}

/**
 * Mount path for shared dynamic-plugin assets.
 *
 * Contract: any deployed plugin may carry a flat `dist/shared/` directory
 * (files only — subdirectories are not served); the resolver serves
 * each file at `<base path>/<filename>` from an in-memory snapshot
 * (contents read once at scan time, like the app-backend's static
 * asset store — no per-request filesystem access)
 * that contains it. Files with the same name in multiple plugins must be
 * content-identical (SHA-256): a conflict fails the conflicting plugin
 * (see `sharedAssets.ts`). Every `.mjs` file registered here is
 * modulepreloaded by `preload.js`; other file types are served but never
 * preloaded.
 *
 * Root-router constraint: this must not prefix-overlap any other root
 * mount — Backstage's root router rejects nested paths outright, so
 * `/.backstage/dynamic-features/shared` is not mountable from a separate
 * plugin. The hyphenated sibling keeps the dynamic-features namespace
 * without nesting.
 */
export const DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH =
  '/.backstage/dynamic-features-shared-modules';

/**
 * Directory inside each deployed plugin (`<plugin>/dist/`) holding shared
 * assets served at {@link DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}.
 * Currently embedded by `rhdh-cli plugin export --shared-esm-runtime`
 * (the shared MF runtime module); the serving surface is generic.
 */
export const SHARED_ASSETS_DIST_DIR = 'shared';
