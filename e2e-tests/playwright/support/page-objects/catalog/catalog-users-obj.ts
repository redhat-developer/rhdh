import { Page } from "@playwright/test";

export class CatalogUsersPO {
  static BASE_URL = "/catalog?filters%5Bkind%5D=user&filters%5Buser";

  static async visitBaseURL(page: Page) {
    await page.goto(this.BASE_URL);
  }
}
