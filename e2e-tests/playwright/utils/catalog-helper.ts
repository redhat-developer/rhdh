import { Page } from "@playwright/test";
import { UIhelper } from "./ui-helper";

export class CatalogHelper {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async goToByName(name: string): Promise<void> {
    await this.uiHelper.openSidebar("Catalog");
    await this.page.fill('input[placeholder="Search"]', name);
    await this.page.waitForSelector(`a:has-text("${name}")`, { timeout: 20000 });
    await this.uiHelper.clickLink(name);
  }
} 