import { dynamicFrontendFeaturesLoader } from "@backstage/frontend-dynamic-feature-loader";
import type {
  FrontendFeature,
  FrontendFeatureLoader,
} from "@backstage/frontend-plugin-api";
import type { ConfigApi } from "@backstage/core-plugin-api";

import { applyBulkRemoteEntries } from "./applyBulk";
import { createBulkRemoteEntriesMfPlugin } from "./mfPlugin";

/**
 * Internal shape of a v1 feature loader — `loader` is implemented by
 * `createFrontendFeatureLoader` but not part of the public type export.
 */
type FeatureLoaderInternal = FrontendFeatureLoader & {
  loader(deps: {
    config: ConfigApi;
  }): Promise<(FrontendFeature | FrontendFeatureLoader)[]>;
};

/**
 * Thin RHDH wrapper around {@link dynamicFrontendFeaturesLoader} (option 2).
 *
 * 1. Awaits bulk.json fetch + classic remoteEntry eval (so
 *    `window[globalName]` exists before `loadRemote`).
 * 2. Passes an MF runtime plugin with `createScript` / `fetch` hooks so
 *    subsequent loads of mapped URLs skip the network.
 *
 * Upstream still owns remotes discovery and `Promise.all(loadRemote)`.
 */
export function rhdhDynamicFrontendFeaturesLoader(): FrontendFeatureLoader {
  const inner = dynamicFrontendFeaturesLoader({
    moduleFederation: {
      plugins: [createBulkRemoteEntriesMfPlugin()],
    },
  }) as FeatureLoaderInternal;

  const wrapped: FeatureLoaderInternal = {
    ...inner,
    async loader(deps) {
      await applyBulkRemoteEntries(deps.config);
      return inner.loader(deps);
    },
  };

  return wrapped;
}
