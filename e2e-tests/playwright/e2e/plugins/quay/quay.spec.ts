import { expect, test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { ImageRegistry } from "../../../utils/quay/quay";

test.describe("Test Quay.io plugin", () => {
  const quayRepository = "rhdh-community/rhdh";
  let uiHelper: UIhelper;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();

    uiHelper = new UIhelper(page);
    await uiHelper.openCatalogSidebar("Component");
    await uiHelper.clickLink("Red Hat Developer Hub");
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
    await expect(cell).toBeVisible();
  });
});
