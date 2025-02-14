import { expect, test } from "@playwright/test";
import { UiHelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { ImageRegistry } from "../../../utils/quay/quay";

test.describe("Test Quay.io plugin", () => {
  const quayRepository = "rhdh-community/rhdh";
  let uiHelper: UiHelper;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();

    uiHelper = new UiHelper(page);
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.clickByDataTestId("user-picker-all");
    await uiHelper.clickLink("Backstage Showcase");
    await uiHelper.clickTab("Image Registry");
  });

  test("Check if Image Registry is present", async ({ page }) => {
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
  });

  test("Check Security Scan details", async ({ page }) => {
    const cell = await ImageRegistry.getScanCell(page);
    const resultText = await cell.textContent();

    if (resultText.includes("unsupported")) {
      await expect(cell.getByRole("link")).toHaveCount(0);
    } else {
      await cell.getByRole("link").click();
      await uiHelper.verifyHeading("Vulnerabilities for sha256:");
      await uiHelper.verifyColumnHeading(ImageRegistry.getAllScanColumnsText());

      if (resultText.includes("Passed")) {
        await uiHelper.verifyCellsInTable(["No records to display"]);
      } else {
        await uiHelper.verifyCellsInTable(
          ImageRegistry.getScanCellsIdentifier(),
        );
      }
    }
  });
});
