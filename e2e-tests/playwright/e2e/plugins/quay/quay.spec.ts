import { expect } from "@playwright/test";
import { ImageRegistry } from "../../../utils/quay/quay";
import { guestTest } from "../../../support/fixtures/guest-login";

guestTest.describe("Test Quay.io plugin", () => {
  const quayRepository = "rhdh-community/rhdh";

  guestTest.beforeEach(async ({ uiHelper }) => {
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Backstage Showcase");
    await uiHelper.clickTab("Image Registry");
  });

  guestTest(
    "Check if Image Registry is present",
    async ({ page, uiHelper }) => {
      await uiHelper.verifyHeading(quayRepository);

      const allGridColumnsText = ImageRegistry.getAllGridColumnsText();

      // Verify Headers
      for (const column of allGridColumnsText) {
        const columnLocator = page.locator("th").filter({ hasText: column });
        await expect(columnLocator).toBeVisible();
      }

      await page
        .locator('div[data-testid="quay-repo-table"]')
        .waitFor({ state: "visible" });
      // Verify cells with the adjusted selector
      const allCellsIdentifier = ImageRegistry.getAllCellsIdentifier();
      await uiHelper.verifyCellsInTable(allCellsIdentifier);
    },
  );

  guestTest("Check Security Scan details", async ({ page }) => {
    const cell = await ImageRegistry.getScanCell(page);
    await expect(cell).toBeVisible();
  });
});
