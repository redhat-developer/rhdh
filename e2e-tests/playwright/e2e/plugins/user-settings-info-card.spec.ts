import { test } from "@support/coverage/test";

import { HomePage } from "../../support/pages/home-page";
import { SettingsPage } from "../../support/pages/settings-page";

test.describe("Test user settings info card", { tag: "@layer3-equivalent" }, () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let homePage: HomePage;
  let settingsPage: SettingsPage;

  test.beforeEach(({ guestPage }) => {
    homePage = new HomePage(guestPage);
    settingsPage = new SettingsPage(guestPage);
  });

  test("Check if customized build info is rendered", async () => {
    await homePage.openHomeSidebar();
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
