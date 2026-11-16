import * as runtimeCore from "@module-federation/runtime-core";

type FederationRuntimeGlobal = typeof globalThis & {
  _FEDERATION_RUNTIME_CORE?: typeof runtimeCore;
  _FEDERATION_RUNTIME_CORE_FROM?: { name: string; version: string };
};

/**
 * Remotes exported with Module Federation `experiments.externalRuntime: true`
 * (rhdh-cli default) do not embed `@module-federation/runtime-core`. They
 * resolve it from `globalThis._FEDERATION_RUNTIME_CORE` instead.
 *
 * Shipped as `public/federation-runtime.js` (see `federation-runtime-entry.ts`)
 * and loaded synchronously from `index.html` before `preload.js` injects
 * remoteEntry scripts. Calling from the main app bundle is too late — preload
 * races ahead of webpack/rspack entry execution.
 *
 * @see https://module-federation.io/configure/experiments.html#externalruntime
 */
export function provideExternalFederationRuntime(): void {
  const g = globalThis as FederationRuntimeGlobal;
  if (g._FEDERATION_RUNTIME_CORE) {
    return;
  }
  g._FEDERATION_RUNTIME_CORE = runtimeCore;
  g._FEDERATION_RUNTIME_CORE_FROM = {
    name: "app",
    version: "provided-by-rhdh",
  };
}
