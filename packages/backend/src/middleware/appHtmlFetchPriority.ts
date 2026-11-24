import type { RequestHandler } from 'express';

/**
 * Serve-time rewrite of the app's HTML responses: every `<script defer …>`
 * tag not already carrying `fetchpriority` gains `fetchpriority="high"`.
 *
 * The app's core bundles (runtime, vendor, main, module-*) are injected into
 * the built index by upstream `@backstage/cli-module-build` and are not
 * reachable from the app's `public/index.html` template. Parser-discovered
 * defer scripts sit in a lower network priority tier than the preload and
 * modulepreload links `preload.js` emits for the dynamic plugins; on
 * connection-limited transports (HTTP/1.1) at scale (~200 links), the
 * app's own scripts can be starved for seconds behind the plugin wave.
 * Raising them to High fixes the inversion; defer execution order is
 * unchanged (network priority only), and old browsers ignore the attribute.
 *
 * The app-backend's templated index reaches `res.send` as a Buffer (from
 * `injectConfigIntoHtml`); both string and Buffer bodies are handled,
 * preserving the body's original type on the way out.
 *
 * Fail-soft: if upstream changes the emitted tag shape, rewrites drop to
 * zero and the HTML serves unchanged (with a one-time warning) — degrading
 * to the no-hint behavior, never to broken markup.
 *
 * Note: a dynamic plugin that fully replaces `core.rootHttpRouter` (via
 * `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE`) must re-include this middleware to
 * keep the same behavior.
 */

/**
 * Matches an opening `<script …>` tag that carries a `defer` attribute but
 * no `fetchpriority` attribute. `[^>]` matches newlines, so multi-line tags
 * (the pretty-printed template form) are covered.
 */
const DEFER_SCRIPT_WITHOUT_FETCH_PRIORITY =
  /<script\b(?=[^>]*\bdefer\b)(?![^>]*\bfetchpriority\b)([^>]*)>/g;

const FETCH_PRIORITY_WARNING =
  'appHtmlFetchPriority: no <script defer> tags without fetchpriority found in an HTML response — ' +
  'the upstream cli-module-build tag shape may have changed; serving the HTML unchanged';

let warnedZeroRewrites = false;

/** Adds fetchpriority="high" to defer script tags; returns the count rewritten. */
export function addFetchPriorityToDeferScripts(html: string): {
  html: string;
  rewritten: number;
} {
  let rewritten = 0;
  const result = html.replace(
    DEFER_SCRIPT_WITHOUT_FETCH_PRIORITY,
    (_match, attributes: string) => {
      rewritten++;
      return `<script${attributes} fetchpriority="high">`;
    },
  );
  return { html: result, rewritten };
}

export const appHtmlFetchPriorityMiddleware: RequestHandler = (
  _req,
  res,
  next,
) => {
  const originalSend = res.send.bind(res);
  res.send = (body?: unknown) => {
    if (
      String(res.getHeader('Content-Type') ?? '').includes('text/html') &&
      (typeof body === 'string' || Buffer.isBuffer(body))
    ) {
      const { html, rewritten } = addFetchPriorityToDeferScripts(
        body.toString('utf8'),
      );
      if (rewritten === 0 && !warnedZeroRewrites) {
        warnedZeroRewrites = true;
        console.warn(FETCH_PRIORITY_WARNING);
      }
      return originalSend(
        typeof body === 'string' ? html : Buffer.from(html, 'utf8'),
      );
    }
    return originalSend(body);
  };
  next();
};
