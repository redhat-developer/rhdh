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

  test("Verify that links in Learning Paths for Backstage opens in a new tab", async ({
    page,
  }, testInfo) => {
    await sidebarPage.openReferencesLearningPaths();
    await sidebarPage.verifyLearningPathLinksOpenInNewTab();

    await runAccessibilityTests(page, testInfo);
  });
});
