// https://github.com/gashcrumb/dynamic-plugins-root-http-middleware/tree/main/plugins/middleware-header-example
// Requires ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE=true environment variable

import test, { expect } from "@playwright/test";
import { Common } from "../../utils/common";

test.describe("Test middleware plugin", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }) => {
    // Skip tests if the simple-chat backend is not working
    const common = new Common(page);
    await common.loginAsGuest();
    await page.goto("/simple-chat", { waitUntil: "domcontentloaded" });

    // Check if error message is displayed (backend not working)
    const errorVisible = await page
      .getByText("Error fetching messages")
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (errorVisible) {
      test.skip(
        true,
        "simple-chat backend not available - ensure plugins are loaded and ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE=true",
      );
    }
  });

  // Test that middleware adds default header when not using proxy
  test("Middleware adds default header value without proxy", async ({
    page,
  }) => {
    // "Use Proxy" checkbox should be unchecked by default
    await page.getByRole("textbox").fill("direct message");
    await page.getByRole("textbox").press("Enter");

    // Middleware should add "goodbye" header when no header is present
    await expect(
      page.getByText('with test header value "goodbye"'),
    ).toBeVisible({ timeout: 30000 });
  });

  // Test that middleware passes through proxy header
  test("Middleware passes through proxy header value", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Use Proxy" }).check();
    await page.getByRole("textbox").fill("proxy message");

    const postResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/proxy/add-test-header") &&
        response.request().method() === "POST",
    );

    await page.getByRole("textbox").press("Enter");
    await postResponsePromise;

    // Proxy adds "hello!" header, middleware should pass it through
    await expect(page.getByText('with test header value "hello!"')).toBeVisible(
      { timeout: 30000 },
    );
  });
});
