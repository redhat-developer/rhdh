import { HomePage } from "../support/pages/home-page";
import { guestTest } from "../support/fixtures/guest-login";

guestTest.describe("Guest Signing Happy path", () => {
  let homePage: HomePage;

  guestTest.beforeEach(async ({ page }) => {
    homePage = new HomePage(page);
  });

  guestTest(
    "Verify the Homepage renders with Search Bar, Quick Access and Starred Entities",
    async ({ uiHelper }) => {
      await uiHelper.verifyHeading("Welcome back!");
      await uiHelper.openSidebar("Home");
      await homePage.verifyQuickAccess("Developer Tools", "Podman Desktop");
    },
  );

  guestTest(
    "Verify Profile is Guest in the Settings page",
    async ({ uiHelper }) => {
      await uiHelper.goToSettingsPage();
      await uiHelper.verifyHeading("Guest");
      await uiHelper.verifyHeading("User Entity: guest");
    },
  );

  guestTest(
    "Sign Out and Verify that you return to the Sign-in page",
    async ({ uiHelper, common }) => {
      await uiHelper.goToSettingsPage();
      await common.signOut();
    },
  );
});
