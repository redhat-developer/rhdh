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
    await expect
      .poll(
        async () => {
          try {
            const response = await request.get("/healthcheck");
            if (response.status() !== 200) {
              return false;
            }
            const body = await response.json();
            return (
              typeof body === "object" &&
              body !== null &&
              Reflect.get(body, "status") === "ok"
            );
          } catch {
            return false;
          }
        },
        { timeout: 30_000, intervals: [2_000] },
      )
      .toBe(true);
  });
});
