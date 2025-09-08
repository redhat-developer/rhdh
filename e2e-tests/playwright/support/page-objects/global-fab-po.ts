import { expect, Page } from "@playwright/test";
import { PageObject, PagesUrl } from "./page";

export class FabPo extends PageObject {
  constructor(page: Page, url: PagesUrl) {
    super(page, url);
  }

  private generateDataTestId(label: string) {
    return label.split(" ").join("-").toLocaleLowerCase();
  }

  public async verifyPopup(expectedUrl: string) {
    const popupPromise = this.page.waitForEvent("popup");
    const popup = await popupPromise;
    expect(popup.url()).toContain(expectedUrl);
  }

  public async clickFabMenuByLabel(label: string) {
    const locator = this.page.getByTestId(this.generateDataTestId(label));
    await locator.click();
  }

  public async clickFabMenuByTestId(id: string) {
    const locator = this.page.getByTestId(id);
    await locator.click();
  }

  public async verifyFabButtonByLabel(label: string) {
    const locator = this.page.getByTestId(this.generateDataTestId(label));
    await expect(locator).toContainText(label);
  }

  public async verifyFabButtonByDataTestId(id: string) {
    const locator = this.page.getByTestId(id);
    await expect(locator).toBeVisible();
  }
}
