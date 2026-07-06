import { expect, type Page } from "@playwright/test";

export async function expandLegacySection(page: Page, sectionLabel: string): Promise<void> {
  const button = page.locator(`nav button[aria-label="${sectionLabel}"]`);
  await expect(button).toBeVisible();
  await button.click();
}

export async function openLegacyLink(page: Page, linkName: string): Promise<void> {
  const link = page.locator(`nav a:has-text("${linkName}")`).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.dispatchEvent("click");
}

export async function waitForLegacySidebarVisible(page: Page): Promise<void> {
  await page.waitForSelector("nav a", { timeout: 10_000 });
}
