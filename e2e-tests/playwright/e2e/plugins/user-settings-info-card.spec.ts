import { test } from "@support/coverage/test";

import { RhdhHomePage } from "../../support/pages/rhdh-home-page";
import { SettingsPage } from "../../support/pages/settings-page";
import { Common } from "../../utils/common";

test.describe("Test user settings info card", { tag: "@layer3-equivalent" }, () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let rhdhHomePage: RhdhHomePage;
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();

    rhdhHomePage = new RhdhHomePage(page);
    settingsPage = new SettingsPage(page);
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test("Check if customized build info is rendered", { tag: "@cluster-free" }, async () => {
    await rhdhHomePage.openHomeSidebar();
    await settingsPage.openFromProfile("Guest");

    await settingsPage.verifyBuildInfoCardVisible();
    await settingsPage.verifyBuildInfoText("TechDocs builder: local");
    await settingsPage.verifyBuildInfoText("Authentication provider: Github");

    await settingsPage.expandShowMoreSection();

    await settingsPage.verifyBuildInfoText("TechDocs builder: local");
    await settingsPage.verifyBuildInfoText("Authentication provider: Github");
    await settingsPage.verifyBuildInfoText("RBAC: disabled");
  });
});
