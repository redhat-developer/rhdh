import { test, expect } from "@playwright/test";
import { ReportingApi } from "@reportportal/agent-js-playwright";

test.describe("Application health check", () => {
  ReportingApi.addAttributes([
    {
      key: "component",
      value: "core",
    },
  ]);

  test("Application health check", async ({ request }) => {

  const healthCheckEndpoint = "/healthcheck";

  const response = await request.get(healthCheckEndpoint);

  const responseBody = await response.json();

  expect(response.status()).toBe(200);

  expect(responseBody).toHaveProperty("status", "ok");
  });
});
