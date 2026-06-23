import { expect, test } from "@support/coverage/test";
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

    // Scope to main content area to get only Learning Path links
    const learningPathLinks = page.getByRole("main").getByRole("link");

    for (const learningPathCard of await learningPathLinks.all()) {
      await expect(learningPathCard).toBeVisible();
      await expect(learningPathCard).toHaveAttribute("target", "_blank");
      await expect(learningPathCard).not.toHaveAttribute("href", "");
    }

    await runAccessibilityTests(page, testInfo);
  });
});
