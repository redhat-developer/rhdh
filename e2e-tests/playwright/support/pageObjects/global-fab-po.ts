import { expect, Locator, Page } from "@playwright/test";
import { PageObject, PagesUrl } from "./page";

export class FabPo extends PageObject {
  private fabMenu: Locator;

  constructor(page: Page, url: PagesUrl) {
    super(page, url);
  }

  private generateDataTestId(label: string) {
    return label.split(" ").join("-").toLocaleLowerCase();
  }

  public async verifyPopup(str: string) {
    const popupPromise = this.page.waitForEvent("popup");
    const popup = await popupPromise;
    await expect(popup).toHaveTitle(str);
  }

  public async clickFabMenu() {
    await this.fabMenu.click();
  }

  public async switchTab() {
    await this.page.bringToFront();
  }

  public async verifyFabButtonByLabel(label: string) {
    this.fabMenu = this.page.getByTestId(this.generateDataTestId(label));
    await expect(this.fabMenu).toContainText(label);
  }

  public async verifyFabButtonByDataTestId(id: string) {
    this.fabMenu = this.page.getByTestId(id);
    await expect(this.fabMenu).toBeVisible();
  }
}
