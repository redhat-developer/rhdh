import { test } from "@support/coverage/test";

import { SettingsPage } from "../../support/pages/settings-page";

test.describe("Test user settings info card", { tag: "@layer3-equivalent" }, () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let settingsPage: SettingsPage;

  test.beforeEach(({ guestPage }) => {
    settingsPage = new SettingsPage(guestPage);
  });

  test("Check if customized build info is rendered", { tag: "@cluster-free-capable" }, async () => {
    await settingsPage.open();

    await settingsPage.verifyBuildInfoCardVisible();
    await settingsPage.verifyBuildInfoText("TechDocs builder: local");
    await settingsPage.verifyBuildInfoText("Authentication provider: Github");

    await settingsPage.expandShowMoreSection();

    await settingsPage.verifyBuildInfoText("TechDocs builder: local");
    await settingsPage.verifyBuildInfoText("Authentication provider: Github");
    await settingsPage.verifyBuildInfoText("RBAC: disabled");
  });
});
