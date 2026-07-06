import { test } from "@support/coverage/test";

import { HomePage } from "../support/pages/home-page";
import { RhdhHomePage } from "../support/pages/rhdh-home-page";
import { SettingsPage } from "../support/pages/settings-page";
import { Common } from "../utils/common";

test.describe("Guest Signing Happy path", () => {
  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });
  });

  let rhdhHomePage: RhdhHomePage;
  let homePage: HomePage;
  let settingsPage: SettingsPage;
  let common: Common;

  test.beforeEach(async ({ page }) => {
    rhdhHomePage = new RhdhHomePage(page);
    homePage = new HomePage(page);
    settingsPage = new SettingsPage(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  // @cluster-free: verified green on the cluster-free harness (playwright.legacy-local.config.ts)
  test(
    "Verify the Homepage renders with Search Bar, Quick Access and Starred Entities",
    { tag: "@cluster-free" },
    async () => {
      await rhdhHomePage.verifyWelcomeHeading();
      await rhdhHomePage.openHomeSidebar();
      await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
    },
  );

  test("Verify Profile is Guest in the Settings page", { tag: "@cluster-free" }, async () => {
    await settingsPage.open();
    await settingsPage.verifyGuestProfile();
  });

  test(
    "Sign Out and Verify that you return to the Sign-in page",
    { tag: "@cluster-free" },
    async () => {
      await settingsPage.open();
      await common.signOut();
      await settingsPage.verifySignInPageTitle();
    },
  );
});
