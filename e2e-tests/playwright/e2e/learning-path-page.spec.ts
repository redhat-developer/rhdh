import { test } from "@support/coverage/test";

import { SidebarPage } from "../support/pages/sidebar-page";
import { runAccessibilityTests } from "../utils/accessibility";
import { Common } from "../utils/common";

test.describe("Learning Paths", { tag: "@layer3-equivalent" }, () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  let common: Common;
  let sidebarPage: SidebarPage;

  test.beforeEach(async ({ page }) => {
    sidebarPage = new SidebarPage(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test(
    "Verify that links in Learning Paths for Backstage opens in a new tab",
    { tag: "@cluster-free" },
    async ({ page }, testInfo) => {
      await sidebarPage.openReferencesLearningPaths();
      await sidebarPage.verifyLearningPathLinksOpenInNewTab();

      await runAccessibilityTests(page, testInfo);
    },
  );
});
