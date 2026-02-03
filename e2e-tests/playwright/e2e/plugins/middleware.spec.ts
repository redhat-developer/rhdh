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

  // Test that middleware adds default header when not using proxy
  test("Middleware adds default header value without proxy", async ({
    page,
  }) => {
    const common = new Common(page);

    await common.loginAsGuest();
    await page.goto("/simple-chat", { waitUntil: "domcontentloaded" });
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
    const common = new Common(page);

    await common.loginAsGuest();
    await page.goto("/simple-chat", { waitUntil: "domcontentloaded" });
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
