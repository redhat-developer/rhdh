import { Page, expect } from "@playwright/test";

export class TechRadar {
  page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async verifyRadarDetails(section: string, text: string) {
    const sectionLocator = this.page
      .locator(`h2:has-text("${section}")`)
      .locator("xpath=ancestor::*")
      .locator(`text=${text}`);
    await sectionLocator.scrollIntoViewIfNeeded();
    await expect(sectionLocator).toBeVisible();
  }
}
