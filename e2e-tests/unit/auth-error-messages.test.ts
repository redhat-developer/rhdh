import { describe, expect, it } from "vitest";

import { NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE } from "../playwright/utils/constants";

/** Fixture shaped like the Backstage sign-in alert for unresolved catalog users. */
const UI_NO_USER_ALERT =
  "Login failed; caused by Error: Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver.";

describe("NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE", () => {
  it("matches the Backstage unresolved-identity alert text", () => {
    expect(UI_NO_USER_ALERT).toMatch(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE);
  });

  it("does not require a literal ';u' typo from a bad unicode-flag edit", () => {
    expect(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE.source).toContain("Login failed; caused by");
    expect(NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE.source).not.toContain("Login failed;u caused");
  });
});
