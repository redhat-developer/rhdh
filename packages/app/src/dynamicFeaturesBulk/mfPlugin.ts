import { evalClassicRemoteEntry } from "./applyBulk";
import {
  lookupBulkSource,
  markBulkExecuted,
  wasBulkExecuted,
} from "./sourceMap";

/**
 * Minimal Module Federation runtime plugin shape used by
 * `dynamicFrontendFeaturesLoader({ moduleFederation: { plugins } })`.
 * Avoids a hard dependency on `@module-federation/runtime-core` types.
 */
export interface RhdhMfRuntimePlugin {
  name: string;
  createScript?: (args: {
    url: string;
    attrs?: Record<string, unknown>;
  }) =>
    HTMLScriptElement | { script?: HTMLScriptElement; timeout?: number } | void;
  fetch?: (url: string, init: RequestInit) => Promise<Response> | false | void;
}

/**
 * Placeholder script so MF `loadScript` gets an onload without a network
 * hop. Content was already applied synchronously via
 * {@link evalClassicRemoteEntry} (with faked `currentScript`).
 *
 * Uses a data: URL rather than blob: so we do not require `script-src blob:`
 * for the common recovery path. (Blob URLs also break webpack
 * `publicPath: "auto"` — stripping `blob:` leaves the page origin.)
 */
function noopLoadScript(): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = "data:text/javascript,";
  return script;
}

/**
 * MF runtime plugin: short-circuit `createScript` / `fetch` for URLs already
 * present in the bulk source map (remoteEntries + expose sync chunks).
 *
 * Classic remoteEntries are normally already evaluated by
 * {@link applyBulkRemoteEntries} before `loadRemote`, so MF
 * `getRemoteEntryExports` returns early and never hits createScript. The
 * hooks still cover:
 * - Race / re-entry if loadRemote starts before apply finishes (shouldn't
 *   happen when the feature-loader wrapper awaits apply)
 * - Sync chunk script/fetch loads from the same bulk map
 *
 * `createScript` applies mapped sources with {@link evalClassicRemoteEntry}
 * (faked `currentScript` → correct webpack publicPath) then returns a
 * no-op script for onload — not a blob of the source.
 */
export function createBulkRemoteEntriesMfPlugin(): RhdhMfRuntimePlugin {
  return {
    name: "rhdh-bulk-remote-entries",
    createScript({ url }): HTMLScriptElement | void {
      const source = lookupBulkSource(url);
      if (source === undefined) {
        return undefined;
      }
      if (wasBulkExecuted(url)) {
        return noopLoadScript();
      }
      try {
        evalClassicRemoteEntry(source, url);
        markBulkExecuted(url);
      } catch (err) {
        // eslint-disable-next-line no-console -- bootstrap path has no app logger yet
        console.error(
          `dynamic-features-bulk: createScript failed for ${url}: ${err}`,
        );
        return undefined;
      }
      return noopLoadScript();
    },
    fetch(url): Promise<Response> | void {
      const source = lookupBulkSource(url);
      if (source === undefined) {
        return undefined;
      }
      return Promise.resolve(
        new Response(source, {
          status: 200,
          headers: { "Content-Type": "application/javascript" },
        }),
      );
    },
  };
}
