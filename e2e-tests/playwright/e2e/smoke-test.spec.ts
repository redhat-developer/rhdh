import { test } from "@support/coverage/test";

import { RhdhHomePage } from "../support/pages/rhdh-home-page";
import { Common } from "../utils/common";
import { waitForRhdhReady } from "../utils/wait-for-rhdh-ready";

test.describe("Smoke test", { tag: "@smoke" }, () => {
  let rhdhHomePage: RhdhHomePage;
  let common: Common;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(async ({ page, request }) => {
    await waitForRhdhReady(request);
    rhdhHomePage = new RhdhHomePage(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test("Verify the RHDH instance homepage renders", { tag: "@cluster-free" }, async () => {
    await rhdhHomePage.verifyWelcomeHeading();
  });
});
