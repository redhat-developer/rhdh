import { expect, Page } from "@playwright/test";

import { UIhelper } from "../../utils/ui-helper";

/** Application provider plugin test page interactions. */
export class ApplicationProviderTestPage {
  private readonly page: Page;
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.ui = new UIhelper(page);
  }

  async open(): Promise<void> {
    await this.ui.goToPageUrl("/application-provider-test-page");
  }

  async verifyTestPageContent(): Promise<void> {
    await this.ui.verifyText("application/provider TestPage");
    await this.ui.verifyText(
      "This card will work only if you register the TestProviderOne and TestProviderTwo correctly.",
    );
  }

  async verifyContextOneCard(): Promise<void> {
    await this.ui.verifyTextinCard("Context one", "Context one");
  }

  async verifyContextTwoCard(): Promise<void> {
    await this.ui.verifyTextinCard("Context two", "Context two");
  }

  private contextCards(contextLabel: string) {
    /* oxlint-disable playwright/no-raw-locators -- per-card containers are nested divs inside one article */
    return this.page
      .getByRole("main")
      .getByRole("article")
      .locator("> div > div")
      .filter({ hasText: contextLabel });
    /* oxlint-enable playwright/no-raw-locators */
  }

  async incrementFirstCardCounter(contextLabel: string): Promise<void> {
    await this.contextCards(contextLabel).first().getByRole("button", { name: "+" }).click();
  }

  async verifySharedCardCount(contextLabel: string, count: string): Promise<void> {
    const cards = this.contextCards(contextLabel);
    await expect(cards.first().getByRole("heading", { name: count })).toBeVisible();
    await expect(cards.last().getByRole("heading", { name: count })).toBeVisible();
  }
}
