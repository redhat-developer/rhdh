import { expect } from "@playwright/test";
import { guestTest } from "../../../support/fixtures/guest-login";

guestTest.describe("Validate Sidebar Navigation Customization", () => {
  guestTest(
    "Verify menu order and navigate to Docs",
    async ({ uiHelper, page }) => {
      // Verify presence of 'References' menu and related items
      const referencesMenu = uiHelper.getSideBarMenuItem("References");
      expect(referencesMenu).not.toBeNull();
      expect(referencesMenu.getByText("APIs")).not.toBeNull();
      expect(referencesMenu.getByText("Learning Paths")).not.toBeNull();

      // Verify 'Favorites' menu and 'Docs' submenu item
      const favoritesMenu = uiHelper.getSideBarMenuItem("Favorites");
      const docsMenuItem = favoritesMenu.getByText("Docs");
      expect(docsMenuItem).not.toBeNull();

      // Open the 'Favorites' menu and navigate to 'Docs'
      await uiHelper.openSidebarButton("Favorites");
      await uiHelper.openSidebar("Docs");

      // Verify if the Documentation page has loaded
      await uiHelper.verifyHeading("Documentation");
      await uiHelper.verifyText("Documentation available in", false);

      // Verify the presense/absense of the 'Test' buttons in the sidebar
      await uiHelper.verifyText("Test enabled");
      await expect(
        page.getByRole("link", { name: "Test disabled" }),
      ).not.toBeVisible();

      // Verify the presence/absense of nested 'Test' buttons in the sidebar
      await uiHelper.openSidebarButton("Test enabled");
      await uiHelper.verifyText("Test nested enabled");
      await expect(
        page.getByRole("link", { name: "Test nested disabled" }),
      ).not.toBeVisible();

      await uiHelper.verifyText("Test_i enabled");
      await expect(
        page.getByRole("link", { name: "Test_i disabled" }),
      ).not.toBeVisible();
    },
  );
});
