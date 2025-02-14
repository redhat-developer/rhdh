// https://github.com/gashcrumb/dynamic-plugins-root-http-middleware/tree/main/plugins/middleware-header-example

import test, { request } from "@playwright/test";
import { Common } from "../../utils/common";
import { LOGGER } from "../../utils/logger";

test.only("Check the middleware is working", async ({ page }) => {
  const common = new Common(page);
  await common.loginAsGuest();
  const context = await request.newContext();
  const response1 = await context.get("/add-test-header");
  const response2 = await context.get("/api/simple-chat");
  LOGGER.info(response1.headers());
  LOGGER.info(response2.headers());
  console.log(response1.headers());
  console.log(response2.headers());
  await page.goto("/simple-chat", { waitUntil: "networkidle" });
  test.fail();
});
