import { expect } from "@playwright/test";
import { test } from "sealights-playwright-plugin";

test("Application health check", async ({ request }) => {
  const healthCheckEndpoint = "/healthcheck";

  const response = await request.get(healthCheckEndpoint);

  const responseBody = await response.json();

  expect(response.status()).toBe(200);

  expect(responseBody).toHaveProperty("status", "ok");
});
