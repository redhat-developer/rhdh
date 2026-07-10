import { describe, expect, it } from "vitest";

import { isJsonHealthcheckResponse } from "../playwright/utils/wait-for-rhdh-ready";

describe("isJsonHealthcheckResponse", () => {
  it("accepts 200 JSON health responses", () => {
    expect(isJsonHealthcheckResponse(200, "application/json")).toBe(true);
  });

  it("rejects 503 so callers can surface backend-not-ready", () => {
    expect(isJsonHealthcheckResponse(503, "application/json")).toBe(false);
  });

  it("rejects non-JSON 200 responses", () => {
    expect(isJsonHealthcheckResponse(200, "text/html")).toBe(false);
  });
});
