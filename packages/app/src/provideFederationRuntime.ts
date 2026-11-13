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
 * Call this once during app bootstrap before dynamic remotes load.
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
