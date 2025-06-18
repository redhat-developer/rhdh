import { expect } from "@playwright/test";
import { guestTest } from "../support/fixtures/guest-login";

guestTest.describe("Header mount points", () => {
  guestTest.beforeEach(async ({ page }) => {
    await expect(page.locator("nav[id='global-header']")).toBeVisible();
  });

  guestTest(
    "Verify that additional logo component in global header is visible",
    async ({ page, uiHelper }) => {
      const header = page.locator("nav[id='global-header']");
      await expect(header).toBeVisible();
      uiHelper.verifyLink({ label: "test-logo" });
    },
  );

  guestTest(
    "Verify that additional header button component from a custom header plugin in global header is visible",
    async ({ page }) => {
      const header = page.locator("nav[id='global-header']");
      await expect(header).toBeVisible();
      expect(header.locator("button", { hasText: "Test Button" })).toHaveCount(
        1,
      );
    },
  );

  guestTest(
    "Verify that additional header from a custom header plugin besides the default one is visible",
    async ({ page }) => {
      const header = page.locator("header", {
        hasText: "This is a test header!",
      });
      await expect(header).toBeVisible();
    },
  );
});
