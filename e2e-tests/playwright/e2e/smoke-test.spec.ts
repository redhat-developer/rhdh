import { HomePage } from "../support/pages/home-page";
import { guestTest } from "../support/fixtures/guest-login";

guestTest.describe("Smoke test", () => {
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
});
