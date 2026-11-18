/**
 * Meta written by backend `preload.js` when option-2 bulk mode is active.
 * @see packages/backend/src/modules/dynamicFeaturesPreload/handler.ts
 */
export interface DynamicFeaturesBulkMeta {
  enabled: boolean;
  /** Content hash of bulk.json when enabled. */
  hash?: string;
  /** Absolute path of bulk.json (e.g. `/.backstage/dynamic-features-preload/bulk.json`). */
  url?: string;
}

export interface BulkRemoteEntriesPayload {
  version: 1;
  sources: Record<string, string>;
  /** Classic remoteEntry URLs to evaluate before `loadRemote`. */
  evaluate: string[];
}

declare global {
  interface Window {
    __DYNAMIC_FEATURES_BULK__?: DynamicFeaturesBulkMeta;
  }
}
