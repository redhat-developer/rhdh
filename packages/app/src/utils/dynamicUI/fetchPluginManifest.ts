// typescript
export function installFetchManifestHandler(): void {
  if (typeof window === 'undefined') return;
  const marker = '__fetchManifestHandlerInstalled';
  if ((window as any)[marker]) return;
  (window as any)[marker] = true;

  const originalFetch = window.fetch.bind(window);

  function pluginName(urlStr: string): string {
    try {
      const u = new URL(urlStr, window.location.origin);
      const segments = u.pathname.split('/').filter(Boolean);
      const idx = segments.lastIndexOf('plugin-manifest.json');
      if (idx > 0) return decodeURIComponent(segments[idx - 1]);
      if (
        segments.length &&
        segments[segments.length - 1].includes('plugin-manifest.json') &&
        segments.length > 1
      ) {
        return decodeURIComponent(segments[segments.length - 2]);
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function manifestResponse(urlStr: string): Response {
    const pName = pluginName(urlStr);
    const message = `Plugin manifest for ${pName} not found. Plugin is misconfigured or cache is not applied yet (wait a bit and refresh the page if later)`;
    return new Response(JSON.stringify({ message, _missingManifest: true }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  (window as any).fetch = async (input: RequestInfo, init?: RequestInit) => {
    // const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    let urlStr: string;
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input instanceof Request) {
      urlStr = input.url;
    } else {
      urlStr = String(input);
    }
    const isManifest = urlStr.includes('plugin-manifest.json');

    try {
      const res = await originalFetch(input, init);
      if (isManifest && res.status === 404) {
        return manifestResponse(urlStr);
      }
      return res;
    } catch (err) {
      if (isManifest) {
        return manifestResponse(urlStr);
      }
      throw err;
    }
  };
}
