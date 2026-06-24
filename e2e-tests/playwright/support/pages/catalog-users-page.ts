import { Page, Locator } from "@playwright/test";

export const CATALOG_USERS_BASE_URL =
  "/catalog?filters%5Bkind%5D=user&filters%5Buser";

/** Catalog users list and entity page interactions. */
export class CatalogUsersPage {
  static readonly BASE_URL = CATALOG_USERS_BASE_URL;

  constructor(private readonly page: Page) {}

  getListOfUsers(): Locator {
    return this.page
      .getByRole("table")
      .first()
      .getByRole("rowgroup")
      .nth(1)
      .getByRole("cell")
      .getByRole("link");
  }

  getEmailLink(): Locator {
    return this.page.getByRole("link", { name: /@/u });
  }

  async visitUserPage(username: string): Promise<void> {
    await this.page
      .getByRole("table")
      .getByRole("link", { name: new RegExp(username, "iu") })
      .first()
      .click();
  }

  getGroupLink(groupName: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(groupName, "iu") });
  }

  async visitBaseURL(): Promise<void> {
    await this.page.goto(CatalogUsersPage.BASE_URL);
  }
}
