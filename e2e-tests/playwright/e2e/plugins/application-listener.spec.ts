import { expect, test } from "@playwright/test";

import { Common } from "../../utils/common";
import { UiHelper } from "../../utils/ui-helper";

test.describe("Test ApplicationListener", () => {
  let uiHelper: UiHelper;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    uiHelper = new UiHelper(page);
    await common.loginAsGuest();
  });

  test("Verify that the LocationListener logs the current location", async ({
    page,
  }) => {
    const logs: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "log") {
        logs.push(msg.text());
      }
    });

    await uiHelper.openSidebar("Catalog");

    expect(logs.some((l) => l.includes("pathname: /catalog"))).toBeTruthy();
  });
});
