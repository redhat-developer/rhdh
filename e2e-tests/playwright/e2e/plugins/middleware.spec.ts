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
    await page.goto("/simple-chat", { waitUntil: "domcontentloaded" });
    await page.getByRole("checkbox", { name: "Use Proxy" }).check();
    await page.getByRole("textbox").fill("hi");

    const responsePromise = page.waitForResponse(
      "**/api/proxy/add-test-header",
    );
    await page.getByRole("textbox").press("Enter");
    const response = await responsePromise;
    const headers = await response.allHeaders();
    console.log("All headers:", headers);
    console.log("Target header:", headers["x-proxy-test-header"]);

    // eslint-disable-next-line playwright/valid-expect
    expect(headers["x-proxy-test-header"]);
  });
});
