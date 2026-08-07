/**
 * Parse an HTTP(S) proxy URL into Playwright's proxy config.
 *
 * Playwright's `proxy` option expects `username` and `password` as separate
 * fields, but CI environments typically set a single `HTTPS_PROXY` URL like
 * `http://user:pass@host:3128`. This helper splits the URL into the shape
 * Playwright needs.
 *
 * Returns `undefined` when no proxy URL is provided (connected environments).
 */
export function parseProxy(
  proxyUrl: string | undefined,
): { server: string; username?: string; password?: string } | undefined {
  if (proxyUrl === undefined || proxyUrl === "") return undefined;
  try {
    const u = new URL(proxyUrl);
    return {
      server: `${u.protocol}//${u.host}`,
      ...(u.username !== "" && { username: decodeURIComponent(u.username) }),
      ...(u.password !== "" && { password: decodeURIComponent(u.password) }),
    };
  } catch {
    return { server: proxyUrl };
  }
}
