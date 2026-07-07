import { expect, type BrowserContext, type Page } from "@playwright/test";

import {
  getCurrentLanguage,
  getTranslations,
  type Locale,
} from "../../e2e/localization/locale";
import {
  handleGitHubPopupLogin,
  handleGitlabPopupLogin,
  handleKeycloakPopupLogin,
  handleMicrosoftAzurePopupLogin,
  handlePingFederatePopupLogin,
} from "../../utils/common/auth-popup";
import * as interaction from "../../utils/ui-helper/interaction";
import { waitForAppReady } from "./app-shell";

const t = getTranslations();

export class AuthProviderSession {
  constructor(
    private readonly page: Page,
    private readonly locale?: Locale,
  ) {}

  private lang(): Locale {
    return this.locale ?? getCurrentLanguage();
  }

  async clearAuthState(context: BrowserContext): Promise<void> {
    await context.clearCookies();
    await context.clearPermissions();
  }

  private async openLandingPageWithProviderMessage(message: string): Promise<void> {
    await this.page.goto("/");
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

  async loginWithKeycloak(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(t["rhdh"][lang]["signIn.providers.oidc.message"]);
    const popup = await this.openPrimarySignInPopup();
    return handleKeycloakPopupLogin(popup, username, password);
  }

  async loginWithGitHub(username: string, password: string, twofactor: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.github.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handleGitHubPopupLogin(popup, username, password, twofactor);
  }

  async loginWithGitHubFromSettingsPage(
    username: string,
    password: string,
    twofactor: string,
  ): Promise<string> {
    const lang = this.lang();
    await this.page.goto("/settings/auth-providers");

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

    return handleGitHubPopupLogin(popup, username, password, twofactor);
  }

  async loginWithGitLab(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.gitlab.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handleGitlabPopupLogin(popup, username, password);
  }

  async loginWithMicrosoftAzure(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.microsoft.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handleMicrosoftAzurePopupLogin(popup, username, password);
  }

  async loginWithPingFederate(username: string, password: string): Promise<string> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(t["rhdh"][lang]["signIn.providers.oidc.message"]);
    const popup = await this.openPrimarySignInPopup();
    return handlePingFederatePopupLogin(popup, username, password);
  }
}
