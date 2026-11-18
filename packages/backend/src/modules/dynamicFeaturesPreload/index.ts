/**
 * Dynamic-features preload internals — collector, handler, bootstrap,
 * store, paths.
 *
 * Wired by {@link dynamicFeaturesResolver} in the parent modules directory.
 * No public exports; all access is via direct imports from the plugin.
 *
 * ## Features bootstrap (option 1)
 *
 * When `dynamicPlugins.frontend.featuresBootstrap.enabled` is true
 * (default), the backend concatenates classic `remoteEntry.js` bodies into
 * `features.<contenthash>.js` (also served at stable `features.js` with
 * ETag revalidation). `packages/app/public/index.html` loads `preload.js`
 * then `features.js` as deferred scripts.
 *
 * MF `loadRemote` does not re-fetch those remoteEntries: after the bootstrap
 * script runs, `window[globalName]` is set and
 * `@module-federation/runtime-core` `getRemoteEntryExports` returns early.
 *
 * Sync expose chunks are still fetched individually (follow-up). ESM
 * remotes are not inlined; they keep modulepreload hints.
 */
