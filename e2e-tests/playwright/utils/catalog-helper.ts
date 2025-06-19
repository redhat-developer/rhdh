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
    await this.uiHelper.searchInputPlaceholder(name);
    await this.uiHelper.verifyLink(name);
    await this.uiHelper.clickLink(name);
  }
} 