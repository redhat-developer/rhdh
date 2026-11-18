/**
 * Dynamic-features preload internals — collector, handler,
 * concatRemoteEntries, store, paths.
 *
 * Wired by {@link dynamicFeaturesResolver} in the parent modules directory.
 * No public exports; all access is via direct imports from the plugin.
 *
 * ## Concatenated classic remoteEntries (option 3)
 *
 * When `dynamicPlugins.frontend.concatRemoteEntries.enabled` is true
 * (default), the backend concatenates classic `remoteEntry.js` bodies into
 * `features-remote-entries.<contenthash>.js` (also served at stable
 * `features-remote-entries.js` with ETag revalidation).
 * `packages/app/public/index.html` loads `preload.js` then
 * `features-remote-entries.js` as deferred scripts.
 *
 * MF `loadRemote` does not re-fetch those remoteEntries: after the concat
 * script runs, `window[globalName]` is set and
 * `@module-federation/runtime-core` `getRemoteEntryExports` returns early.
 *
 * Sync expose chunks are still fetched individually (prefer fat remoteEntry
 * builds so sync lists are empty — see migrating-plugins docs). ESM remotes
 * are not concatenated; they keep modulepreload hints.
 */
