import { describe, expect, it } from "vitest";

import { isPopupLoginSuccess } from "../playwright/support/auth/app-shell";

describe("isPopupLoginSuccess", () => {
  it("treats Login successful and Already logged in as success", () => {
    expect(isPopupLoginSuccess("Login successful")).toBe(true);
    expect(isPopupLoginSuccess("Already logged in")).toBe(true);
  });

  it("treats IdP rejection statuses as not success", () => {
    expect(isPopupLoginSuccess("User does not exist")).toBe(false);
    expect(isPopupLoginSuccess("Login failed - invalid credentials")).toBe(false);
  });
});
