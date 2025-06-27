import { expect } from "@playwright/test";
import { guestTest } from "../support/fixtures/guest-login";

guestTest.describe("Learning Paths", () => {
  guestTest(
    "Verify that links in Learning Paths for Backstage opens in a new tab",
    async ({ page, uiHelper }) => {
      await uiHelper.openSidebarButton("References");
      await uiHelper.openSidebar("Learning Paths");

      for (let i = 0; i < 5; i++) {
        const learningPathCard = page
          .locator(`div[class*="MuiGrid-item"]>a[target="_blank"]`)
          .nth(i);
        await expect(learningPathCard).toBeVisible();
        expect(await learningPathCard.getAttribute("href")).not.toBe("");
      }
    },
  );
});
