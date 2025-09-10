import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
test.describe("Header mount points", () => {
  let common: Common;
  let uiHelper: UIhelper;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "navigation",
    });
  });

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsGuest();
    await expect(page.locator("nav[id='global-header']")).toBeVisible();
  });

  test("Verify that additional logo component in global header is visible", async ({
    page,
  }) => {
    const header = page.locator("nav[id='global-header']");
    await expect(header).toBeVisible();
    await uiHelper.verifyLink({ label: "test-logo" });
  });

  test("Verify that additional header button component from a custom header plugin in global header is visible", async ({
    page,
  }) => {
    const header = page.locator("nav[id='global-header']");
    await expect(header).toBeVisible();
    await expect(
      header.locator("button", { hasText: "Test Button" }),
    ).toHaveCount(1);
  });

  test("Verify that additional header from a custom header plugin besides the default one is visible", async ({
    page,
  }) => {
    const header = page.locator("header", {
      hasText: "This is a test header!",
    });
    await expect(header).toBeVisible();
  });
});
