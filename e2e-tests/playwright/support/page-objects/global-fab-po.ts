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
    // The FAB sub-menu items animate into position and React continuously
    // re-renders the component tree, so the element is never "stable" in
    // Playwright's sense — it keeps getting detached and re-attached
    // between animation frames. A trial-click toPass() loop confirms
    // stability, but the element detaches again before the real click
    // lands (verified: 0/5 passes with that approach).
    // dispatchEvent bypasses actionability checks; the preceding
    // toBeVisible guards against clicking a missing element.
    await expect(locator).toBeVisible({ timeout: 15000 });
    await locator.dispatchEvent("click");
  }

  public async clickFabMenuByTestId(id: string) {
    const locator = this.page.getByTestId(id);
    await locator.click();
  }

  public async verifyFabButtonByLabel(label: string) {
    const locator = this.page.getByTestId(this.generateDataTestId(label));
    await expect(locator).toBeVisible();
    await expect(locator).toContainText(label);
  }

  public async verifyFabButtonByDataTestId(id: string) {
    const locator = this.page.getByTestId(id);
    await expect(locator).toBeVisible();
  }
}
