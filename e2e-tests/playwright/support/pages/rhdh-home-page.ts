import { expect, Page } from "@playwright/test";

import { UIhelper } from "../../utils/ui-helper";

/** RHDH instance home page interactions. */
export class RhdhHomePage {
  private readonly page: Page;
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.ui = new UIhelper(page);
  }

  async verifyWelcomeHeading(): Promise<void> {
    await this.ui.verifyHeading("Welcome back!");
  }

  async openHomeSidebar(): Promise<void> {
    await this.ui.openSidebar("Home");
  }

  async verifyTextInCard(cardHeading: string, text: string | RegExp, exact = true): Promise<void> {
    await this.ui.verifyTextinCard(cardHeading, text, exact);
  }

  async verifyHeading(heading: string | RegExp): Promise<void> {
    await this.ui.verifyHeading(heading);
  }

  async verifyDivHasText(text: string | RegExp): Promise<void> {
    await this.ui.verifyDivHasText(text);
  }

  async clickButton(label: string): Promise<void> {
    await this.ui.clickButton(label);
  }

  async verifyMainHeadingVisible(): Promise<void> {
    await expect(this.page.getByRole("heading", { level: 1 })).toBeVisible();
  }
}
