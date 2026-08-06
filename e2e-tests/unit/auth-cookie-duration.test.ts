import { describe, expect, it } from "vitest";

import {
  THREE_DAYS_MS,
  refreshTokenRemainingMs,
} from "../playwright/utils/authentication-providers/auth-cookie-duration";

describe("refreshTokenRemainingMs", () => {
  it("converts Playwright cookie expires (unix seconds) to remaining ms", () => {
    const now = Date.UTC(2026, 0, 1);
    const expiresUnixSeconds = Math.floor((now + THREE_DAYS_MS) / 1000);

    expect(refreshTokenRemainingMs({ expires: expiresUnixSeconds }, now)).toBe(THREE_DAYS_MS);
  });
});
