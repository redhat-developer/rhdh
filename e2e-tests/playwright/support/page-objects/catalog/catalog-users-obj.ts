import { Page, Locator } from "@playwright/test";

export class CatalogUsersPO {
  static BASE_URL = "/catalog?filters%5Bkind%5D=user&filters%5Buser";

  static getListOfUsers(page: Page): Locator {
    // Get all user links in the table's Name column (first cell of each row)
    // These links point to /catalog/{namespace}/user/{username}
    return page.getByRole("table").locator("tbody a[href*='/catalog/'][href*='/user/']");
  }

  static getEmailLink(page: Page): Locator {
    return page.getByRole("link", { name: /@/ });
  }

  static async visitUserPage(page: Page, username: string) {
    // Click on user link in the table by name
    await page
      .getByRole("table")
      .getByRole("link", { name: new RegExp(username, "i") })
      .first()
      .click();
  }

  static getGroupLink(page: Page, groupName: string): Locator {
    return page.getByRole("link", { name: new RegExp(groupName, "i") });
  }

  static async visitBaseURL(page: Page) {
    await page.goto(this.BASE_URL);
  }
}
