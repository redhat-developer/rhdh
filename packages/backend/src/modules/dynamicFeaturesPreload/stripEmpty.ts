/**
 * Recursively drop empty values from a JSON-like structure.
 *
 * Removed:
 * - `null` / `undefined`
 * - empty strings (`""`)
 * - empty arrays (`[]`), including after children are stripped
 * - empty objects (`{}`), including after children are stripped
 *
 * Used when embedding MF snapshots into `preload.js` so fields like
 * `"usedExports":[]` or `"css":{"async":[],"sync":[]}` do not bloat the
 * payload. Callers that need a concrete object/array after stripping
 * should fall back with `?? {}` / `?? []`.
 */
export function stripEmpty(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    const next = value
      .map(item => stripEmpty(item))
      .filter(item => item !== undefined);
    return next.length === 0 ? undefined : next;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const stripped = stripEmpty(child);
    if (stripped !== undefined) {
      out[key] = stripped;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
