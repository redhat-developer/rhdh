import { expect, type BrowserContext, type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations, type Locale } from "../../e2e/localization/locale";
import {
  handleGitHubPopupLogin,
  handleGitlabPopupLogin,
  handleKeycloakPopupLogin,
  handleMicrosoftAzurePopupLogin,
  handlePingFederatePopupLogin,
} from "../../utils/common/auth-popup";
import * as interaction from "../../utils/ui-helper/interaction";
import { waitForAppReady, waitForAuthenticatedShell } from "./app-shell";

const t = getTranslations();

export class AuthProviderSession {
  constructor(
    private readonly page: Page,
    private readonly locale?: Locale,
    private readonly baseURL?: string,
  ) {}

  private lang(): Locale {
    return this.locale ?? getCurrentLanguage();
  }

  /** Prefer absolute URLs when baseURL is known so relative goto works without context baseURL. */
  private resolveUrl(path: string): string {
    if (this.baseURL === undefined || this.baseURL === "") {
      return path;
    }
    const base = this.baseURL.endsWith("/") ? this.baseURL : `${this.baseURL}/`;
    return new URL(path, base).href;
  }

  async clearAuthState(context: BrowserContext): Promise<void> {
    await context.clearCookies();
    await context.clearPermissions();
  }

  private async openLandingPageWithProviderMessage(message: string): Promise<void> {
    await this.page.goto(this.resolveUrl("/"));
    await waitForAppReady(this.page);
    await expect(this.page.getByRole("main").getByText(message)).toBeVisible();
  }

  private async openPrimarySignInPopup(): Promise<Page> {
    const lang = this.lang();
    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      interaction.clickButton(this.page, t["core-components"][lang]["signIn.title"]),
    ]);
    return popup;
  }

  private async finishLogin(popupResult: Promise<string>): Promise<string> {
    const result = await popupResult;
    // Popup close ≠ authenticated shell — wait for global header before callers
    // navigate via Settings POM (goToSettingsPage / profile dropdown).
    await waitForAuthenticatedShell(this.page);
    return result;
  }

  async loginWithKeycloak(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(t["rhdh"][lang]["signIn.providers.oidc.message"]);
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleKeycloakPopupLogin(popup, username, password));
  }

  async loginWithGitHub(username: string, password: string, twofactor: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.github.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleGitHubPopupLogin(popup, username, password, twofactor));
  }

  async loginWithGitHubFromSettingsPage(
    username: string,
    password: string,
    twofactor: string,
  ): Promise<string> {
    const lang = this.lang();
    await this.page.goto(this.resolveUrl("/settings/auth-providers"));

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.page
        // Intentional divergence: provider settings expose sign-in via title tooltip, not button role.
        .getByTitle(
          t["user-settings"][lang]["providerSettingsItem.title.signIn"].replace(
            "{{title}}",
            "GitHub",
          ),
        )
        .click(),
      interaction.clickButton(this.page, t["core-components"][lang]["oauthRequestDialog.login"]),
    ]);

    return this.finishLogin(handleGitHubPopupLogin(popup, username, password, twofactor));
  }

  async loginWithGitLab(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.gitlab.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleGitlabPopupLogin(popup, username, password));
  }

  async loginWithMicrosoftAzure(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.microsoft.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleMicrosoftAzurePopupLogin(popup, username, password));
  }

  async loginWithPingFederate(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(t["rhdh"][lang]["signIn.providers.oidc.message"]);
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handlePingFederatePopupLogin(popup, username, password));
  }
}
