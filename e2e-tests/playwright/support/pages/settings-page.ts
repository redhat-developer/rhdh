import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import {
  getCurrentLanguage,
  getTranslations,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

/** Settings and profile interactions (POM wrapper over UIhelper). */
export class SettingsPage {
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.ui = new UIhelper(page);
  }

  async open(): Promise<void> {
    await this.ui.goToSettingsPage();
  }

  async verifyProfileHeading(name: string): Promise<void> {
    await this.ui.verifyHeading(name);
  }

  async verifyGuestProfile(): Promise<void> {
    await this.verifyProfileHeading("Guest");
    await this.ui.verifyHeading("User Entity: guest");
  }

  async verifySignInPageTitle(): Promise<void> {
    await this.ui.verifyHeading(t["rhdh"][lang]["signIn.page.title"]);
  }

  async verifySignInError(message: string | RegExp): Promise<void> {
    await this.ui.verifyAlertErrorMessage(message);
  }

  async hideQuickstartIfVisible(): Promise<void> {
    await this.ui.hideQuickstartIfVisible();
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await this.ui.verifyText(text, exact);
  }

  async goToPageUrl(url: string, heading?: string): Promise<void> {
    await this.ui.goToPageUrl(url, heading);
  }

  async verifyTextVisible(
    text: string,
    exact = false,
    timeout = 10000,
  ): Promise<void> {
    await this.ui.verifyTextVisible(text, exact, timeout);
  }

  async clickButtonByText(
    buttonText: string | RegExp,
    options?: { exact?: boolean; timeout?: number; force?: boolean },
  ): Promise<void> {
    await this.ui.clickButtonByText(buttonText, options);
  }

  async uncheckCheckbox(label: string): Promise<void> {
    await this.ui.uncheckCheckbox(label);
  }

  async checkCheckbox(label: string): Promise<void> {
    await this.ui.checkCheckbox(label);
  }

  async verifyLocalizedUserSettingsLabels(
    locale: keyof (typeof t)["user-settings"],
  ): Promise<void> {
    const labels = t["user-settings"][locale];
    await this.ui.verifyText(labels["profileCard.title"]);
    await this.ui.verifyText(labels["appearanceCard.title"]);
    await this.ui.verifyText(labels["themeToggle.title"]);
    await this.ui.verifyText(labels["signOutMenu.title"]);
    await this.ui.verifyText(labels["identityCard.title"]);
    await this.ui.verifyText(
      `${labels["identityCard.userEntity"]}: Guest User`,
    );
    await this.ui.verifyText(
      `${labels["identityCard.ownershipEntities"]}: ownershipEntities`,
    );
    await this.ui.verifyText(labels["pinToggle.title"]);
    await this.ui.verifyText(labels["pinToggle.description"]);
  }

  async verifyLocalizedUserSettingsLabelsWithOwnership(
    locale: keyof (typeof t)["user-settings"],
    ownershipEntities: string,
  ): Promise<void> {
    const labels = t["user-settings"][locale];
    await this.ui.verifyText(labels["profileCard.title"]);
    await this.ui.verifyText(labels["appearanceCard.title"]);
    await this.ui.verifyText(labels["themeToggle.title"]);
    await this.ui.verifyText(labels["identityCard.title"]);
    await this.ui.verifyText(
      `${labels["identityCard.userEntity"]}: Guest User`,
    );
    await this.ui.verifyText(
      `${labels["identityCard.ownershipEntities"]}: ${ownershipEntities}`,
    );
    await this.ui.verifyText(labels["pinToggle.title"]);
    await this.ui.verifyText(labels["pinToggle.description"]);
  }

  async togglePinSidebar(
    locale: keyof (typeof t)["user-settings"],
  ): Promise<void> {
    const labels = t["user-settings"][locale];
    await this.ui.uncheckCheckbox(labels["pinToggle.ariaLabelTitle"]);
    await this.ui.checkCheckbox(labels["pinToggle.ariaLabelTitle"]);
  }

  async verifyRhdhMetadata(page: Page): Promise<void> {
    await page.getByTitle("Show more").click();
    await this.ui.verifyText("RHDH Metadata");
  }
}
