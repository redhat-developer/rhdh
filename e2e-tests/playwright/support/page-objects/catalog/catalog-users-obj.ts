import { Page, Locator } from "@playwright/test";

export const CatalogUsersPO = {
  BASE_URL: "/catalog?filters%5Bkind%5D=user&filters%5Buser",

  getListOfUsers(page: Page): Locator {
    // Get all user links in the table's body
    // Using rowgroup to target tbody, then getting links within cells
    // These links point to /catalog/{namespace}/user/{username}
    return (
      page
        .getByRole("table")
        .first()
        // Scope to the first table (users table), not pagination table
        .getByRole("rowgroup")
        // Second rowgroup (data rows), 0-indexed: 0=header, 1=data
        .nth(1)
        .getByRole("cell")
        .getByRole("link")
    );
  },

  getEmailLink(page: Page): Locator {
    return page.getByRole("link", { name: /@/u });
  },

  async visitUserPage(page: Page, username: string) {
    // Click on user link in the table by name
    await page
      .getByRole("table")
      .getByRole("link", { name: new RegExp(username, "iu") })
      .first()
      .click();
  },

  getGroupLink(page: Page, groupName: string): Locator {
    return page.getByRole("link", { name: new RegExp(groupName, "iu") });
  },

  async visitBaseURL(page: Page) {
    await page.goto(CatalogUsersPO.BASE_URL);
  },
};
