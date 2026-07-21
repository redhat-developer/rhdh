import { test } from "@support/coverage/test";

import { HomePage } from "../support/pages/home-page";
import { SettingsPage } from "../support/pages/settings-page";

test.describe("Guest Signing Happy path", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });
  });

  let homePage: HomePage;
  let settingsPage: SettingsPage;

  test.beforeEach(({ guestPage }) => {
    homePage = new HomePage(guestPage);
    settingsPage = new SettingsPage(guestPage);
  });

  // @cluster-free-capable: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test(
    "Verify the Homepage renders with Search Bar, Quick Access and Starred Entities",
    { tag: "@cluster-free-capable" },
    async () => {
      await homePage.verifyWelcomeHeading();
      await homePage.openHomeSidebar();
      await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
    },
  );

  test(
    "Verify Profile is Guest in the Settings page",
    { tag: "@cluster-free-capable" },
    async () => {
      await settingsPage.open();
      await settingsPage.verifyGuestProfile();
    },
  );

  test(
    "Sign Out and Verify that you return to the Sign-in page",
    { tag: "@cluster-free-capable" },
    async () => {
      await settingsPage.open();
      await settingsPage.signOut();
      await settingsPage.verifySignInPageTitle();
    },
  );
});
