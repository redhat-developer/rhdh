import { test, expect } from "@support/coverage/test";

test.describe("Application health check", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test("Application health check", async ({ request }) => {
    // Poll so transient GKE TLS/socket disconnects retry instead of failing once.
    await expect
      .poll(
        async () => {
          try {
            const response = await request.get("/healthcheck");
            if (response.status() !== 200) {
              return false;
            }
            const responseBody = await response.json();
            return (
              typeof responseBody === "object" &&
              responseBody !== null &&
              Reflect.get(responseBody, "status") === "ok"
            );
          } catch {
            return false;
          }
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBe(true);
  });
});
