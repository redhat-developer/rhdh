import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

/** Application provider plugin test page interactions. */
export class ApplicationProviderTestPage {
  private readonly ui: UIhelper;

  constructor(page: Page) {
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
}
