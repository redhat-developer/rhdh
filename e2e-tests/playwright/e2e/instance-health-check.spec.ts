import { test, expect } from "@playwright/test";

test.describe("Application health check", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test("Application health check", async ({ request }) => {
    // Short poll: one TLS blip should not fail; deploy readiness already waited.
    let lastDetail = "not probed";
    try {
      await expect
        .poll(
          async () => {
            try {
              const response = await request.get("/healthcheck");
              if (response.status() !== 200) {
                lastDetail = `HTTP ${response.status()}`;
                return false;
              }
              const contentType = response.headers()["content-type"] ?? "";
              if (!contentType.includes("application/json")) {
                lastDetail = `unexpected content-type: ${contentType || "(missing)"}`;
                return false;
              }
              const body = await response.json();
              const ok =
                typeof body === "object" &&
                body !== null &&
                Reflect.get(body, "status") === "ok";
              if (!ok) {
                lastDetail = "unexpected body";
              }
              return ok;
            } catch (error) {
              lastDetail =
                error instanceof Error ? error.message : String(error);
              return false;
            }
          },
          { timeout: 30_000, intervals: [2_000] },
        )
        .toBe(true);
    } catch {
      throw new Error(
        `RHDH /healthcheck not ready after 30s (last: ${lastDetail})`,
      );
    }
  });
});
