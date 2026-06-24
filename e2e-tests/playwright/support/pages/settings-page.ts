import { expect, Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import * as interaction from "../../utils/ui-helper/interaction";
import * as misc from "../../utils/ui-helper/misc";
import * as navigation from "../../utils/ui-helper/navigation";
import * as verification from "../../utils/ui-helper/verification";
import { SETTINGS_PAGE_COMPONENTS } from "../selectors/page-selectors";

const t = getTranslations();
const lang = getCurrentLanguage();

const LANGUAGE_OPTIONS_PATTERN = /English|Deutsch|Español|Français|Italiano|日本語/u;

/** Settings and profile interactions. */
export class SettingsPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(): Promise<void> {
    await navigation.goToSettingsPage(this.page);
  }

  async verifyProfileHeading(name: string): Promise<void> {
    await verification.verifyHeading(this.page, name);
  }

  async verifyGithubUserProfile(userId: string): Promise<void> {
    await verification.verifyHeading(this.page, userId);
    await verification.verifyHeading(this.page, `User Entity: ${userId}`);
  }

  async verifySignInButtonVisible(): Promise<void> {
    await expect(this.page.getByRole("button", { name: "Sign In" })).toBeVisible();
  }

  async verifyGuestProfile(): Promise<void> {
    await this.verifyProfileHeading("Guest");
    await verification.verifyHeading(this.page, "User Entity: guest");
  }

  async verifySignInPageTitle(): Promise<void> {
    await verification.verifyHeading(this.page, t["rhdh"][lang]["signIn.page.title"]);
  }

  async verifySignInError(message: string | RegExp): Promise<void> {
    await verification.verifyAlertErrorMessage(this.page, message);
  }

  async hideQuickstartIfVisible(): Promise<void> {
    await misc.hideQuickstartIfVisible(this.page);
  }

  async verifyText(text: string | RegExp, exact = true): Promise<void> {
    await verification.verifyText(this.page, text, exact);
  }

  async goToPageUrl(url: string, heading?: string): Promise<void> {
    await navigation.goToPageUrl(this.page, url, heading);
  }

  async verifyTextVisible(text: string, exact = false, timeout = 10000): Promise<void> {
    await verification.verifyTextVisible(this.page, text, exact, timeout);
  }

  async clickButtonByText(
    buttonText: string | RegExp,
    options?: { exact?: boolean; timeout?: number; force?: boolean },
  ): Promise<void> {
    await interaction.clickButtonByText(this.page, buttonText, options);
  }

  async uncheckCheckbox(label: string): Promise<void> {
    await interaction.uncheckCheckbox(this.page, label);
  }

  async checkCheckbox(label: string): Promise<void> {
    await interaction.checkCheckbox(this.page, label);
  }

  async verifyLocalizedUserSettingsLabels(
    locale: keyof (typeof t)["user-settings"],
  ): Promise<void> {
    const labels = t["user-settings"][locale];
    await verification.verifyText(this.page, labels["profileCard.title"]);
    await verification.verifyText(this.page, labels["appearanceCard.title"]);
    await verification.verifyText(this.page, labels["themeToggle.title"]);
    await verification.verifyText(this.page, labels["signOutMenu.title"]);
    await verification.verifyText(this.page, labels["identityCard.title"]);
    await verification.verifyText(this.page, `${labels["identityCard.userEntity"]}: Guest User`);
    await verification.verifyText(
      this.page,
      `${labels["identityCard.ownershipEntities"]}: ownershipEntities`,
    );
    await verification.verifyText(this.page, labels["pinToggle.title"]);
    await verification.verifyText(this.page, labels["pinToggle.description"]);
  }

  async verifyLocalizedUserSettingsLabelsWithOwnership(
    locale: keyof (typeof t)["user-settings"],
    ownershipEntities: string,
  ): Promise<void> {
    const labels = t["user-settings"][locale];
    await verification.verifyText(this.page, labels["profileCard.title"]);
    await verification.verifyText(this.page, labels["appearanceCard.title"]);
    await verification.verifyText(this.page, labels["themeToggle.title"]);
    await verification.verifyText(this.page, labels["identityCard.title"]);
    await verification.verifyText(this.page, `${labels["identityCard.userEntity"]}: Guest User`);
    await verification.verifyText(
      this.page,
      `${labels["identityCard.ownershipEntities"]}: ${ownershipEntities}`,
    );
    await verification.verifyText(this.page, labels["pinToggle.title"]);
    await verification.verifyText(this.page, labels["pinToggle.description"]);
  }

  async togglePinSidebar(locale: keyof (typeof t)["user-settings"]): Promise<void> {
    const labels = t["user-settings"][locale];
    await interaction.uncheckCheckbox(this.page, labels["pinToggle.ariaLabelTitle"]);
    await interaction.checkCheckbox(this.page, labels["pinToggle.ariaLabelTitle"]);
  }

  async verifyLanguageToggleList(locale: keyof (typeof t)["user-settings"]): Promise<void> {
    const labels = t["user-settings"][locale];
    await expect(this.page.getByRole("list").first()).toMatchAriaSnapshot(`
    - listitem:
      - text: ${labels["languageToggle.title"]}
      - paragraph: ${labels["languageToggle.description"]}
    `);
  }

  async verifyLanguageSelectShowsOptions(): Promise<void> {
    await expect(this.page.getByTestId("select")).toContainText(LANGUAGE_OPTIONS_PATTERN);
  }

  async openLanguageSelect(): Promise<void> {
    await this.page
      .getByTestId("select")
      .getByRole("button", { name: LANGUAGE_OPTIONS_PATTERN })
      .click();
  }

  async verifyLanguageOptionsList(): Promise<void> {
    await expect(this.page.getByRole("listbox")).toMatchAriaSnapshot(`
    - listbox:
      - option "English"
      - option "Deutsch"
      - option "Español"
      - option "Français"
      - option "Italiano"
      - option "日本語"
    `);
  }

  async selectLanguage(language: string): Promise<void> {
    await this.page.getByRole("option", { name: language }).click();
  }

  async verifySelectedLanguage(language: string): Promise<void> {
    await expect(this.page.getByTestId("select")).toContainText(language);
  }

  async openUserSettingsMenu(): Promise<void> {
    await SETTINGS_PAGE_COMPONENTS.getUserSettingsMenu(this.page).click();
  }

  async verifySignOutMenuLabel(text: string): Promise<void> {
    await expect(SETTINGS_PAGE_COMPONENTS.getSignOut(this.page)).toContainText(text);
  }

  async closeUserSettingsMenu(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async verifySidebarMenuItemHidden(text: string): Promise<void> {
    await expect(this.page.getByText(text)).toBeHidden();
  }

  async openFromProfile(userName: string): Promise<void> {
    await this.page.getByText(userName).click();
    await this.page.getByRole("menuitem", { name: "Settings" }).click();
  }

  async verifyBuildInfoCardVisible(): Promise<void> {
    await expect(this.page.getByText("RHDH Build info")).toBeVisible();
  }

  async verifyBuildInfoText(text: string): Promise<void> {
    await expect(this.page.getByText(text)).toBeVisible();
  }

  async expandShowMoreSection(): Promise<void> {
    await this.page.getByTitle("Show more").click();
  }

  async verifyGuestSignInMethodNotListed(): Promise<void> {
    const signInMethodsContainer = this.page.getByRole("main");
    const signInMethods = await signInMethodsContainer
      .getByRole("heading", { level: 6 })
      .allInnerTexts();
    expect(signInMethods).not.toContain("Guest");
  }

  async verifyInactivityLogoutMessageHidden(timeout = 30_000): Promise<void> {
    await expect(this.page.getByText("Logging out due to inactivity")).toBeHidden({ timeout });
  }

  async verifyRhdhMetadata(): Promise<void> {
    await this.expandShowMoreSection();
    await verification.verifyText(this.page, "RHDH Metadata");
  }
}
