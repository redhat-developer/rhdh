import { expect, type Page } from "@playwright/test";

import type { SidebarAdapter } from "./sidebar-nav";

export class LegacySidebarAdapter implements SidebarAdapter {
  constructor(private readonly page: Page) {}

  async expandSection(sectionLabel: string): Promise<void> {
    const button = this.page.locator(`nav button[aria-label="${sectionLabel}"]`);
    await expect(button).toBeVisible();
    await button.click();
  }

  async openLink(linkName: string): Promise<void> {
    const link = this.page.locator(`nav a:has-text("${linkName}")`).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.dispatchEvent("click");
  }

  async openInSection(sectionLabel: string, linkName: string): Promise<void> {
    await this.expandSection(sectionLabel);
    await this.openLink(linkName);
  }

  async expectLinkVisible(linkName: string, sectionLabel?: string): Promise<void> {
    if (sectionLabel !== undefined && sectionLabel !== "") {
      await this.expandSection(sectionLabel);
    }
    await expect(this.page.locator(`nav a:has-text("${linkName}")`).first()).toBeVisible();
  }

  async waitForVisible(): Promise<void> {
    await this.page.waitForSelector("nav a", { timeout: 10_000 });
  }
}
