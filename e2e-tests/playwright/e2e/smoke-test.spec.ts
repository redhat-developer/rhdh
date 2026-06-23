import { test } from "@support/coverage/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import { waitForRhdhReady } from "../utils/wait-for-rhdh-ready";

test.describe("Smoke test", { tag: "@smoke" }, () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(async ({ page, request }) => {
    await waitForRhdhReady(request);
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify the RHDH instance homepage renders", async () => {
    await uiHelper.verifyHeading("Welcome back!");
  });
});
