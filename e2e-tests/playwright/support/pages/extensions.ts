import { Page, Locator } from "@playwright/test";

export class Extensions {
  private page: Page;
  public badge: Locator;

  constructor(page: Page) {
    this.page = page;
    this.badge = this.page.getByTestId("TaskAltIcon");
  }

  async selectDropdown(name: string) {
    await this.page.getByLabel(name).getByRole("button").first().click();
  }

  async toggleOption(name: string) {
    await this.page
      .getByRole("option", { name: name })
      .getByRole("checkbox")
      .click();
  }

  async clickAway() {
    this.page.locator("#menu- div").first().click();
  }
}
