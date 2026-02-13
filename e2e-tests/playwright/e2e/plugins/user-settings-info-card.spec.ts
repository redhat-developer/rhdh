import { test, expect } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe("Test user settings info card", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();

    uiHelper = new UIhelper(page);
  });

  test("Check if customized build info is rendered", async ({ page }) => {
    await uiHelper.openSidebar("Home");
    await page.getByText("Guest").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    // Verify card header is visible
    await expect(page.getByText("RHDH Build info")).toBeVisible();

    // Verify initial card content using text content
    await expect(page.getByText("TechDocs builder: local")).toBeVisible();
    await expect(
      page.getByText("Authentication provider: Github"),
    ).toBeVisible();

    await page.getByTitle("Show more").click();

    // Verify expanded card content shows RBAC status
    await expect(page.getByText("TechDocs builder: local")).toBeVisible();
    await expect(
      page.getByText("Authentication provider: Github"),
    ).toBeVisible();
    await expect(page.getByText("RBAC: disabled")).toBeVisible();
  });
});
