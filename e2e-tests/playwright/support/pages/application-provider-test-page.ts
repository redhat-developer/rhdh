import { expect, Page } from "@playwright/test";

import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";

/** Application provider plugin test page interactions. */
export class ApplicationProviderTestPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await navigation.goToPageUrl(this.page, "/application-provider-test-page");
  }

  async verifyTestPageContent(): Promise<void> {
    await verification.verifyText(this.page, "application/provider TestPage");
    await verification.verifyText(
      this.page,
      "This card will work only if you register the TestProviderOne and TestProviderTwo correctly.",
    );
  }

  async verifyContextOneCard(): Promise<void> {
    await expect(this.contextCards("Context one").first()).toBeVisible();
  }

  async verifyContextTwoCard(): Promise<void> {
    await expect(this.contextCards("Context two").first()).toBeVisible();
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
