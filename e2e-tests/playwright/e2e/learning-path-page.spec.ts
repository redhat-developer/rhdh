import { test } from "@support/coverage/test";
import { Common } from "../utils/common";
import { runAccessibilityTests } from "../utils/accessibility";
import { SidebarPage } from "../support/pages/sidebar-page";

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

  test("Verify that links in Learning Paths for Backstage opens in a new tab", async ({
    page,
  }, testInfo) => {
    await sidebarPage.openReferencesLearningPaths();
    await sidebarPage.verifyLearningPathLinksOpenInNewTab();

    await runAccessibilityTests(page, testInfo);
  });
});
