import type { ConfigApi } from '@backstage/core-plugin-api';

import {
  indexBulkSources,
  markBulkExecuted,
} from './sourceMap';
import type { BulkRemoteEntriesPayload } from './types';

const DEFAULT_BULK_PATH = '/.backstage/dynamic-features-preload/bulk.json';

let applyPromise: Promise<void> | undefined;

/**
 * Fake `document.currentScript` while `fn` runs.
 *
 * Webpack classic remotes resolve `publicPath: "auto"` from
 * `document.currentScript.src` (then strip the filename). Plain
 * `(0, eval)(source)` leaves `currentScript` null, so the bundle falls
 * back to the last `<script src="http…">` on the page or throws —
 * breaking chunk URLs. Pointing the getter at the real entry URL makes
 * `__webpack_require__.p` match the remotes publicPath.
 */
function withFakeCurrentScript<T>(entryUrl: string, fn: () => T): T {
  const fake = { src: entryUrl, tagName: 'SCRIPT' as const };
  const proto = Document.prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, 'currentScript');
  Object.defineProperty(proto, 'currentScript', {
    configurable: true,
    enumerable: true,
    get: () => fake,
  });
  try {
    return fn();
  } finally {
    if (previous) {
      Object.defineProperty(proto, 'currentScript', previous);
    } else {
      delete (proto as { currentScript?: unknown }).currentScript;
    }
  }
}

/**
 * Evaluate classic remoteEntry (or sync chunk) source in the global scope
 * so `window[globalName]` / webpack chunk registration runs.
 *
 * When `entryUrl` is provided, temporarily fakes `document.currentScript`
 * so webpack `publicPath: "auto"` resolves to that URL's directory.
 *
 * CSP: indirect `eval` requires `script-src 'unsafe-eval'` (Backstage
 * default already includes it). See option-2 docs for blob: alternatives.
 */
export function evalClassicRemoteEntry(
  source: string,
  entryUrl?: string,
): void {
  const run = () => {
    // eslint-disable-next-line no-eval -- classic MF remoteEntry must run in global scope
    (0, eval)(source);
  };
  if (entryUrl) {
    withFakeCurrentScript(entryUrl, run);
  } else {
    run();
  }
}

function bulkMeta() {
  return typeof window !== 'undefined'
    ? window.__DYNAMIC_FEATURES_BULK__
    : undefined;
}

function resolveBulkUrl(backendBaseUrl: string): string | undefined {
  const meta = bulkMeta();
  if (meta && meta.enabled === false) {
    return undefined;
  }
  const path = meta?.url ?? DEFAULT_BULK_PATH;
  try {
    return new URL(path, backendBaseUrl).href;
  } catch {
    return path;
  }
}

async function doApplyBulk(backendBaseUrl: string): Promise<void> {
  const url = resolveBulkUrl(backendBaseUrl);
  if (!url) {
    return;
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.warn(
      `dynamic-features-bulk: failed to fetch ${url}: ${err}`,
    );
    return;
  }
  if (!response.ok) {
    console.warn(
      `dynamic-features-bulk: ${url} returned ${response.status}`,
    );
    return;
  }

  let payload: BulkRemoteEntriesPayload;
  try {
    payload = (await response.json()) as BulkRemoteEntriesPayload;
  } catch (err) {
    console.warn(`dynamic-features-bulk: invalid JSON from ${url}: ${err}`);
    return;
  }

  if (!payload?.sources || !Array.isArray(payload.evaluate)) {
    return;
  }

  indexBulkSources(payload.sources);

  for (const entryUrl of payload.evaluate) {
    const source = payload.sources[entryUrl];
    if (typeof source !== 'string') {
      continue;
    }
    try {
      evalClassicRemoteEntry(source, entryUrl);
      markBulkExecuted(entryUrl);
    } catch (err) {
      console.error(
        `dynamic-features-bulk: failed evaluating remoteEntry ${entryUrl}: ${err}`,
      );
    }
  }
}

/**
 * Fetch bulk.json once, index sources for MF hooks, and evaluate classic
 * remoteEntries. Safe to call multiple times (deduped promise).
 *
 * No-ops when preload.js set `__DYNAMIC_FEATURES_BULK__.enabled === false`.
 */
export function applyBulkRemoteEntries(
  configOrBaseUrl: ConfigApi | string,
): Promise<void> {
  if (!applyPromise) {
    const backendBaseUrl =
      typeof configOrBaseUrl === 'string'
        ? configOrBaseUrl
        : configOrBaseUrl.getString('backend.baseUrl');
    applyPromise = doApplyBulk(backendBaseUrl).catch(err => {
      console.warn(`dynamic-features-bulk: apply failed: ${err}`);
    });
  }
  return applyPromise;
}

/** Test helper: reset the singleton apply promise. */
export function resetBulkApplyForTests(): void {
  applyPromise = undefined;
}
