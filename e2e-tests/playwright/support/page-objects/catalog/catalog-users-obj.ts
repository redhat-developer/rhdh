import { Page } from "@playwright/test";

export class CatalogUsersPO {
  static BASE_URL = "/catalog?filters%5Bkind%5D=user&filters%5Buser";

  static async getListOfUsers(page: Page) {
    return page.locator('a[href*="/catalog/default/user"]');
  }

  static async getEmailLink(page: Page) {
    return page.locator('a[href*="mailto"][href*="@"]');
  }

  static async visitUserPage(page: Page, username: string) {
    await page.click(`a[href="/catalog/default/user/${username}"]`);
  }

  static async getGroupLink(page: Page, groupName: string) {
    return page.locator(`a[href="/catalog/default/group/${groupName}"]`);
  }

  static async visitBaseURL(page: Page) {
    await page.goto(this.BASE_URL);
  }
}
