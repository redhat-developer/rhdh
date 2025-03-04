import { Page } from "@playwright/test";
import { UiHelper } from "../../utils/ui-helper";

export enum PagesUrl {
  RBAC = "/rbac",
}

export abstract class PageObject {
  protected page: Page;
  protected url: PagesUrl;
  protected uiHelper: UiHelper;

  constructor(page: Page, url: PagesUrl) {
    this.page = page;
    this.url = url;
    this.uiHelper = new UiHelper(this.page);
  }

  async goto() {
    await this.page.goto(this.url);
  }

  async verifyATextIsVisible(text: string) {
    await this.uiHelper.verifyText(text);
  }
}
