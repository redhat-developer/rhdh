import { test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
test.describe("Smoke test", () => {
  let uiHelper: UIhelper;
  let common: Common;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify the Homepage renders", async () => {
    // Wait for page to be fully loaded before proceeding
    await page.waitForTimeout(2000);
    
    // Use CSS selector for more precise element targeting
    const welcomeHeading = page.locator('h1, h2, h3').filter({ hasText: 'Welcome back!' });
    await expect(welcomeHeading).toBeVisible();
    
    // Additional verification using DOM structure
    const headingElement = page.locator('div[class*="welcome"], div[class*="home"] h1, h2, h3');
    expect(await headingElement.count()).toBeGreaterThan(0);
    
    // Verify page title as well
    await page.waitForLoadState('networkidle');
    const pageTitle = await page.title();
    expect(pageTitle).toBeTruthy();
  });
});
