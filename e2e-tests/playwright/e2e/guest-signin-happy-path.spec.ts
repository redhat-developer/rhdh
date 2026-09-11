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

  test(
    "Verify the Homepage renders with Welcome heading, Search and Starred Entities",
    { tag: "@cluster-free-capable" },
    async () => {
      await homePage.verifyWelcomeHeading();
      await homePage.verifySearchWidgetVisible();
      await homePage.verifyTextInCard("Starred Catalog Entities", "Starred Catalog Entities");
    },
  );

  // Not @cluster-free-capable: Quick Access link data comes from the /developer-hub proxy, which
  // only resolves to real content against the CI cluster's test-backstage-customization-provider
  // (DH_TARGET_URL); the cluster-free harness has no such target, so this can't run there.
  test("Verify the Homepage renders with Quick Access", async () => {
    await homePage.verifyWelcomeHeading();
    await homePage.openHomeSidebar();
    await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
  });

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
