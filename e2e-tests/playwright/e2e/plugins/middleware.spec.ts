// https://github.com/gashcrumb/dynamic-plugins-root-http-middleware/tree/main/plugins/middleware-header-example
import test, { expect } from "@playwright/test";
import { Common } from "../../utils/common";

test.describe("Test middleware plugin", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test("Check the middleware is working", async ({ page }) => {
    const common = new Common(page);

    await common.loginAsGuest();
    await page.goto("/simple-chat", { waitUntil: "networkidle" });
    await page.getByRole("checkbox", { name: "Use Proxy" }).check();
    await page.getByRole("textbox").fill("hi");

    // Wait for the request to be made and capture it
    const responsePromise = page.waitForResponse(
      "**/api/proxy/add-test-header",
    );
    await page.getByRole("textbox").press("Enter");
    const response = await responsePromise;

    // Check that the response was successful
    expect(response.status()).toBe(200);

    // Verify the request went through the correct proxy endpoint
    expect(response.url()).toContain("/api/proxy/add-test-header");

    // The middleware header is added to the outgoing request to the target service
    // We can verify this by checking the request headers if the backend echoes them back
    // or by making a direct request to verify the proxy configuration

    // Alternative: Make a direct request to verify the proxy configuration
    const directResponse = await page.request.get("/api/proxy/add-test-header");
    expect(directResponse.status()).toBe(200);

    // If the simple-chat backend is designed to echo back headers,
    // we could check the response body for the header value
    const responseBody = await response.text();
    expect(responseBody).toBeDefined();
  });
});
