import { expect, type Page } from "@playwright/test";

/**
 * Packaged-app sidebar items are not consistently exposed with ARIA roles on
 * nested groups. These selectors match the legacy UIhelper behavior that cluster-free
 * specs were written against.
 */
export async function expandLegacySection(page: Page, sectionLabel: string): Promise<void> {
  const ariaButton = page.locator(`nav button[aria-label="${sectionLabel}"]`);
  if ((await ariaButton.count()) > 0) {
    await expect(ariaButton).toBeVisible();
    await ariaButton.click();
    return;
  }

  const sectionToggle = page.getByTestId("login-button").getByText(sectionLabel);
  await expect(sectionToggle.first()).toBeVisible();
  await sectionToggle.first().click();
}

export async function openLegacyLink(page: Page, linkName: string): Promise<void> {
  const link = page.locator(`nav a:has-text("${linkName}")`).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

export async function waitForLegacySidebarVisible(page: Page): Promise<void> {
  await expect(page.locator("nav a").first()).toBeVisible({ timeout: 10_000 });
}
