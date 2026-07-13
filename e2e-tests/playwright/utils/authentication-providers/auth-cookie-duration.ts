/**
 * Shared refresh-token cookie duration assertions for auth-provider specs.
 */

export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
export const DEFAULT_COOKIE_TOLERANCE_MS = 3 * 60 * 1000;

/** Remaining lifetime of a Playwright cookie from a fixed `now` (ms). */
export function refreshTokenRemainingMs(
  cookie: { expires: number },
  nowMs: number = Date.now(),
): number {
  return cookie.expires * 1000 - nowMs;
}

export function isRefreshTokenDurationNear(
  cookie: { expires: number } | undefined,
  expectedMs: number,
  toleranceMs: number = DEFAULT_COOKIE_TOLERANCE_MS,
  nowMs: number = Date.now(),
): boolean {
  if (cookie === undefined) {
    return false;
  }
  const actual = refreshTokenRemainingMs(cookie, nowMs);
  return actual > expectedMs - toleranceMs && actual < expectedMs + toleranceMs;
}
