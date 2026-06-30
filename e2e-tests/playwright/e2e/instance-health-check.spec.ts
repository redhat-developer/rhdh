import { test, expect } from "@support/coverage/test";

test.describe("Application health check", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test("Application health check", async ({ request }) => {
    const healthCheckEndpoint = "/healthcheck";

    const response = await request.get(healthCheckEndpoint);

    const responseBody: unknown = await response.json();

    expect(response.status()).toBe(200);

    expect(responseBody).toHaveProperty("status", "ok");
  });
});
