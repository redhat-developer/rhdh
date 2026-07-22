import { expect, type BrowserContext, type Page } from "@playwright/test";

import { getCurrentLanguage, getTranslations, type Locale } from "../../e2e/localization/locale";
import {
  handleGitHubPopupLogin,
  handleGitlabPopupLogin,
  handleKeycloakPopupLogin,
  handleMicrosoftAzurePopupLogin,
  handlePingFederatePopupLogin,
} from "../../utils/common/auth-popup";
import { sleep } from "../../utils/poll-until";
import * as interaction from "../../utils/ui-helper/interaction";
import { RHDH_READY_DEFAULT_TIMEOUT_MS } from "../../utils/wait-for-rhdh-ready";
import {
  waitForAppReady,
  waitForLoginOutcome,
  isPopupLoginSuccess,
  type LoginOutcome,
} from "./app-shell";

const t = getTranslations();

/**
 * Connection drops after pod restart / route flip.
 * ERR_ABORTED only when it is a page.goto navigation abort — not arbitrary AbortErrors.
 */
export function isRetryableConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("ERR_CONNECTION_REFUSED") ||
    message.includes("ERR_CONNECTION_RESET") ||
    message.includes("ERR_CONNECTION_CLOSED") ||
    message.includes("ERR_EMPTY_RESPONSE") ||
    message.includes("ERR_NETWORK_CHANGED")
  ) {
    return true;
  }
  // Chromium aborts in-flight navigations when the pod restarts mid-goto after reconcile.
  return message.includes("ERR_ABORTED") && /page\.goto|navigating to/iu.test(message);
}

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

  /** Retry only hard connection failures (e.g. brief post-reconcile downtime). */
  private async gotoWithRetry(url: string, attempts = 3): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
        return;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        lastError = normalized;
        if (!isRetryableConnectionError(error) || attempt === attempts) {
          throw normalized;
        }
        console.log(
          `[INFO] Connection error on attempt ${attempt}/${attempts} for ${url}, retrying: ${normalized.message}`,
        );
        // Clear half-loaded documents so the next goto does not inherit a stuck paint.
        await this.page.goto("about:blank").catch(() => {});
        await sleep(2_000 * attempt);
      }
    }
    throw lastError ?? new Error(`Failed to navigate to ${url}`);
  }

  private async openLandingPageWithProviderMessage(message: string): Promise<void> {
    await this.gotoWithRetry(this.resolveUrl("/"));
    await waitForAppReady(this.page);
    // Post-reconcile SPA can still be hydrating after /healthcheck is OK —
    // give the provider card the same budget as app readiness, not expect's 10s default.
    await expect(this.page.getByRole("main").getByText(message)).toBeVisible({
      timeout: RHDH_READY_DEFAULT_TIMEOUT_MS,
    });
  }

  private async openPrimarySignInPopup(): Promise<Page> {
    const lang = this.lang();
    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      interaction.clickButton(this.page, t["core-components"][lang]["signIn.title"]),
    ]);
    return popup;
  }

  private async finishLogin(popupResult: Promise<string>): Promise<LoginOutcome> {
    const popupStatus = await popupResult;
    // IdP rejection: still race the app shell briefly so alerts can win; fail closed on timeout.
    const timeoutMs = isPopupLoginSuccess(popupStatus) ? RHDH_READY_DEFAULT_TIMEOUT_MS : 15_000;
    return waitForLoginOutcome(this.page, timeoutMs);
  }

  async loginWithKeycloak(username: string, password: string): Promise<LoginOutcome> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(t["rhdh"][lang]["signIn.providers.oidc.message"]);
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleKeycloakPopupLogin(popup, username, password));
  }

  async loginWithGitHub(
    username: string,
    password: string,
    twofactor: string,
  ): Promise<LoginOutcome> {
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
  ): Promise<LoginOutcome> {
    const lang = this.lang();
    await this.gotoWithRetry(this.resolveUrl("/settings/auth-providers"));
    await waitForAppReady(this.page);

    const signInTitle = t["user-settings"][lang]["providerSettingsItem.title.signIn"].replace(
      "{{title}}",
      "GitHub",
    );
    const githubSignIn = this.page.getByTitle(signInTitle);
    await expect(githubSignIn).toBeVisible({ timeout: 30_000 });

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      githubSignIn.click(),
      interaction.clickButton(this.page, t["core-components"][lang]["oauthRequestDialog.login"]),
    ]);

    return this.finishLogin(handleGitHubPopupLogin(popup, username, password, twofactor));
  }

  async loginWithGitLab(username: string, password: string): Promise<LoginOutcome> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.gitlab.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleGitlabPopupLogin(popup, username, password));
  }

  async loginWithMicrosoftAzure(username: string, password: string): Promise<LoginOutcome> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(
      t["rhdh"][lang]["signIn.providers.microsoft.message"],
    );
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handleMicrosoftAzurePopupLogin(popup, username, password));
  }

  async loginWithPingFederate(username: string, password: string): Promise<LoginOutcome> {
    const lang = this.lang();
    await this.openLandingPageWithProviderMessage(t["rhdh"][lang]["signIn.providers.oidc.message"]);
    const popup = await this.openPrimarySignInPopup();
    return this.finishLogin(handlePingFederatePopupLogin(popup, username, password));
  }
}
