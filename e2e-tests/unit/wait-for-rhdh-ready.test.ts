import { describe, expect, it, vi } from "vitest";

import {
  isJsonHealthcheckResponse,
  probeHealthcheck,
  type HealthcheckHttpClient,
} from "../playwright/utils/wait-for-rhdh-ready";

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

describe("probeHealthcheck", () => {
  it("treats transport timeouts as not-ready so expect.poll can keep retrying", async () => {
    const request: HealthcheckHttpClient = {
      get: vi
        .fn<HealthcheckHttpClient["get"]>()
        .mockRejectedValue(new Error("Timeout 10000ms exceeded")),
    };

    const probe = await probeHealthcheck(request);

    expect(probe.ok).toBe(false);
    expect(probe.detail).toBe("request failed: Timeout 10000ms exceeded");
  });

  it("reports status ok for a healthy JSON /healthcheck response", async () => {
    const request: HealthcheckHttpClient = {
      get: vi.fn<HealthcheckHttpClient["get"]>().mockResolvedValue({
        status: () => 200,
        headers: () => ({ "content-type": "application/json" }),
        json: () => Promise.resolve({ status: "ok" }),
      }),
    };

    await expect(probeHealthcheck(request)).resolves.toEqual({
      ok: true,
      detail: "status ok",
    });
  });
});
