import { test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import { ReportingApi } from "@reportportal/agent-js-playwright";

test.describe("Smoke test", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeAll(async () => {
    ReportingApi.addAttributes([
      {
        key: "component",
        value: "core",
      },
    ]);
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify the Homepage renders", async () => {
    await uiHelper.verifyHeading("Welcome back!");
  });
});
