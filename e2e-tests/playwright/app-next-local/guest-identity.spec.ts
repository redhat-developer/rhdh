import { test, expect } from "@support/coverage/test";

/**
 * Slice 1 of the cluster-free local E2E harness (Layer 4a spike, RHIDP-13501).
 *
 * Proves the full local stack works without a cluster: the app-next dev server
 * and the backend are booted by Playwright (see playwright.app-next-local.config.ts),
 * guest sign-in succeeds, and a real plugin page (Settings) renders the guest
 * identity served by the backend.
 *
 * NOTE: assertions target what `packages/app-next` actually renders. The new
 * frontend system registers catalog/scaffolder/search/user-settings/visualizer
 * and has no Home page yet, so this spec deliberately does not assert the legacy
 * "Welcome back!" landing page used by the `packages/app` E2E specs.
 */
test.describe("app-next local — guest sign-in", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "authentication",
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // New-frontend-system guest provider card.
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    // Sidebar appears once signed in.
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("signs in as guest and reaches an authenticated page", async ({
    page,
  }) => {
    await expect(page.getByRole("link", { name: "Catalog" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
  });

  test("Settings page shows the guest Backstage identity", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    // "Backstage Identity" is an InfoCard title (not a heading role).
    await expect(page.getByText("Backstage Identity")).toBeVisible();
    await expect(page.getByText("User Entity:")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "guest" }).first(),
    ).toBeVisible();
  });
});
