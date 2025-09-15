import { expect, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common } from "../../utils/common";

test.describe("Test ApplicationListener", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    uiHelper = new UIhelper(page);
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
