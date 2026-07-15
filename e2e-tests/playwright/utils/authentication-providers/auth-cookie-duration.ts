/**
 * Shared refresh-token cookie duration assertions for auth-provider specs.
 */

import { expect, type BrowserContext } from "@playwright/test";

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

/**
 * Idle logout can clear UI before the httpOnly refresh cookie disappears.
 * Poll until the named cookie is gone instead of a one-shot expect.
 */
export async function waitForNamedCookieAbsent(
  context: BrowserContext,
  cookieName: string,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const cookies = await context.cookies();
        return cookies.some((cookie) => cookie.name === cookieName) ? "present" : "absent";
      },
      { timeout: timeoutMs, intervals: [500, 1000, 2000] },
    )
    .toBe("absent");
}
