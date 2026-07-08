import { test } from "@support/coverage/test";

import { SidebarPage } from "../support/pages/sidebar-page";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Learning Paths", { tag: "@layer3-equivalent" }, () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  let sidebarPage: SidebarPage;

  test.beforeEach(({ guestPage }) => {
    sidebarPage = new SidebarPage(guestPage);
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test(
    "Verify that links in Learning Paths for Backstage opens in a new tab",
    { tag: "@cluster-free" },
    async ({ guestPage }, testInfo) => {
      await sidebarPage.openReferencesLearningPaths();
      await sidebarPage.verifyLearningPathLinksOpenInNewTab();

      await runAccessibilityTests(guestPage, testInfo);
    },
  );
});
