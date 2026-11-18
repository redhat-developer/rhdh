/**
 * In-memory URL → source map shared by the bulk apply step and the MF
 * createScript/fetch plugin. Keys are indexed as absolute href and pathname
 * so hooks can match whatever URL shape MF passes.
 */

const sources = new Map<string, string>();
const executed = new Set<string>();

function pathnameKey(url: string): string | undefined {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    return `${u.pathname}${u.search}`;
  } catch {
    return undefined;
  }
}

export function clearBulkSourceMap(): void {
  sources.clear();
  executed.clear();
}

export function indexBulkSources(record: Record<string, string>): void {
  for (const [url, source] of Object.entries(record)) {
    sources.set(url, source);
    const pathKey = pathnameKey(url);
    if (pathKey) {
      sources.set(pathKey, source);
    }
    try {
      sources.set(new URL(url).href, source);
    } catch {
      // relative / invalid — pathname index is enough
    }
  }
}

export function lookupBulkSource(url: string): string | undefined {
  if (sources.has(url)) {
    return sources.get(url);
  }
  const pathKey = pathnameKey(url);
  if (pathKey && sources.has(pathKey)) {
    return sources.get(pathKey);
  }
  try {
    const href = new URL(url, window.location.href).href;
    if (sources.has(href)) {
      return sources.get(href);
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function markBulkExecuted(url: string): void {
  executed.add(url);
  const pathKey = pathnameKey(url);
  if (pathKey) {
    executed.add(pathKey);
  }
}

export function wasBulkExecuted(url: string): boolean {
  if (executed.has(url)) {
    return true;
  }
  const pathKey = pathnameKey(url);
  return !!(pathKey && executed.has(pathKey));
}

export function bulkSourceMapSize(): number {
  return sources.size;
}
