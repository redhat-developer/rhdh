import { expect, type BrowserContext, type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations } from "../../e2e/localization/locale";
import * as interaction from "../../utils/ui-helper/interaction";
import {
  handleGitHubPopupLogin,
  handleGitlabPopupLogin,
  handleKeycloakPopupLogin,
  handleMicrosoftAzurePopupLogin,
  handlePingFederatePopupLogin,
} from "../../utils/common/auth-popup";
import { waitForAppReady } from "./app-shell";

const t = getTranslations();
const lang = getCurrentLanguage();

export class AuthProviderSession {
  constructor(private readonly page: Page) {}

  async clearAuthState(context: BrowserContext): Promise<void> {
    await context.clearCookies();
    await context.clearPermissions();
  }

  private async openLandingPageWithProviderMessage(message: string): Promise<void> {
    await this.page.goto("/");
    await waitForAppReady(this.page);
    await expect(this.page.getByText(message)).toBeVisible();
  }

  private async openPrimarySignInPopup(): Promise<Page> {
    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      interaction.clickButton(this.page, t["core-components"][lang]["signIn.title"]),
    ]);
    return popup;
  }

  async loginWithKeycloak(username: string, password: string): Promise<string> {
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.oidc.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handleKeycloakPopupLogin(popup, username, password);
  }

  async loginWithGitHub(username: string, password: string, twofactor: string): Promise<string> {
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
    await this.page.goto("/settings/auth-providers");

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.page
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
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.gitlab.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handleGitlabPopupLogin(popup, username, password);
  }

  async loginWithMicrosoftAzure(username: string, password: string): Promise<string> {
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.microsoft.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handleMicrosoftAzurePopupLogin(popup, username, password);
  }

  async loginWithPingFederate(username: string, password: string): Promise<string> {
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.oidc.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return handlePingFederatePopupLogin(popup, username, password);
  }
}
