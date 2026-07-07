import * as fs from "fs";

import { expect, Page } from "@playwright/test";
import { authenticator } from "otplib";

import { getTranslations, getCurrentLanguage } from "../../e2e/localization/locale";
import { SETTINGS_PAGE_COMPONENTS } from "../../support/selectors/page-selectors";
import { getErrorMessage } from "../errors";
import { UIhelper } from "../ui-helper";
import { waitForNextTotpWindow, waitForRhdhReady } from "../wait-for-rhdh-ready";
import {
  handleGitHubPopupLogin,
  handleGitlabPopupLogin,
  handleKeycloakPopupLogin,
  handleMicrosoftAzurePopupLogin,
  handlePingFederatePopupLogin,
} from "./auth-popup";
import { parseAuthStateCookies } from "./browser";

export { setupBrowser, teardownBrowser } from "./browser";

const t = getTranslations();
const lang = getCurrentLanguage();

const LOADING_INDICATOR_SELECTORS = [
  'div[class*="MuiLinearProgress-root"]',
  '[class*="MuiCircularProgress-root"]',
] as const;

export class Common {
  page: Page;
  uiHelper: UIhelper;
  private readonly authStateFileName = "authState.json";

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  private async hasJsonHealthcheck(): Promise<boolean> {
    const response = await this.page.request.get("/healthcheck").catch(() => null);
    if (response === null || response.status() !== 200) {
      return false;
    }
    const contentType = response.headers()["content-type"] ?? "";
    return contentType.includes("json");
  }

  private async waitForAppReady(timeout = 120_000): Promise<void> {
    // Cluster-free legacy harness serves the SPA on BASE_URL; backend readiness is
    // enforced by webServer startup instead of a JSON /healthcheck on the frontend.
    if (await this.hasJsonHealthcheck()) {
      await waitForRhdhReady(this.page.request, timeout);
    }
    await this.waitForLoad(timeout);
  }

  async loginAsGuest() {
    await this.page.goto("/");
    await this.waitForAppReady();
    // RHIDP-2043: Remove dialog handler after dynamic Guest Authentication Provider plugin is created
    this.page.on("dialog", async (dialog) => {
      console.log(`Dialog message: ${dialog.message()}`);
      await dialog.accept();
    });

    await this.uiHelper.verifyHeading(t["rhdh"][lang]["signIn.page.title"]);
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.guestProvider.enter"]);
    await this.uiHelper.waitForSideBarVisible();
  }

  async waitForLoad(timeout = 120000) {
    for (const selector of LOADING_INDICATOR_SELECTORS) {
      await this.page.locator(selector).waitFor({
        state: "hidden",
        timeout: timeout,
      });
    }
  }

  async signOut() {
    await this.page.click(SETTINGS_PAGE_COMPONENTS.userSettingsMenu);
    await this.page.click(SETTINGS_PAGE_COMPONENTS.signOut);
    await this.uiHelper.verifyHeading(t["rhdh"][lang]["signIn.page.title"]);
  }

  private async logintoGithub(userid: string) {
    await this.page.goto("https://github.com/login");
    /* oxlint-disable playwright/no-raw-locators -- GitHub login page (third-party) */
    await expect(this.page.locator("#login_field")).toBeVisible();
    await this.page.fill("#login_field", userid);

    const password =
      userid === process.env.GH_USER_ID
        ? process.env.GH_USER_PASS
        : userid === process.env.GH_USER2_ID
          ? process.env.GH_USER2_PASS
          : undefined;
    if (password === undefined || password === "") {
      throw new Error("Invalid User ID");
    }
    await this.page.fill("#password", password);

    await this.page.click('[value="Sign in"]');
    await this.page.fill("#app_totp", this.getGitHub2FAOTP(userid));
    if (
      (await this.uiHelper.isTextVisible(
        "The two-factor code you entered has already been used",
      )) ||
      (await this.uiHelper.isTextVisible("too many codes have been submitted", 3000))
    ) {
      await waitForNextTotpWindow();
      await this.page.fill("#app_totp", this.getGitHub2FAOTP(userid));
    }

    await this.page.waitForLoadState("domcontentloaded");
    /* oxlint-enable playwright/no-raw-locators */
  }

  async logintoKeycloak(userid: string, password: string) {
    /* oxlint-disable playwright/no-raw-locators -- Keycloak login popup (third-party) */
    await new Promise<void>((resolve) => {
      this.page.once("popup", async (popup) => {
        await popup.waitForLoadState();
        await popup.locator("#username").fill(userid);
        await popup.locator("#password").fill(password);
        try {
          await popup.locator("#kc-login").click({ timeout: 5000 });
        } catch (error) {
          if (!getErrorMessage(error).includes("Target closed")) {
            throw error;
          }
        }
        resolve();
      });
    });
    /* oxlint-enable playwright/no-raw-locators */
  }

  async loginAsKeycloakUser(
    userid: string = process.env.GH_USER_ID ?? "",
    password: string = process.env.GH_USER_PASS ?? "",
  ) {
    await this.page.goto("/");
    await this.waitForAppReady();
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);
    await this.logintoKeycloak(userid, password);
    await this.uiHelper.waitForSideBarVisible();
  }

  async loginAsGithubUser(userid: string = process.env.GH_USER_ID ?? "") {
    const sessionFileName = `authState_${userid}.json`;

    if (fs.existsSync(sessionFileName)) {
      const cookies = parseAuthStateCookies(fs.readFileSync(sessionFileName, "utf-8"));
      await this.page.context().addCookies(cookies);
      console.log(`Reusing existing authentication state for user: ${userid}`);
      await this.page.goto("/");
      await this.waitForAppReady(30_000);
      await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);
      await this.checkAndReauthorizeGithubApp();
    } else {
      await this.logintoGithub(userid);
      await this.page.goto("/");
      await this.waitForAppReady();
      await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);
      await this.checkAndReauthorizeGithubApp();
      await this.uiHelper.waitForSideBarVisible();
      await this.page.context().storageState({ path: sessionFileName });
      console.log(`Authentication state saved for user: ${userid}`);
    }
  }

  async checkAndReauthorizeGithubApp() {
    /* oxlint-disable playwright/no-raw-locators -- GitHub OAuth authorize popup (third-party) */
    await new Promise<void>((resolve) => {
      this.page.once("popup", async (popup) => {
        await popup.waitForLoadState();

        const authorizeButton = popup.locator("button.js-oauth-authorize-btn");
        await Promise.race([
          popup.waitForEvent("close", { timeout: 10_000 }),
          authorizeButton.waitFor({ state: "visible", timeout: 10_000 }),
        ]).catch(() => {});

        if (!popup.isClosed() && (await authorizeButton.isVisible())) {
          await popup.locator("body").click();
          await authorizeButton.waitFor();
          await authorizeButton.click();
        }
        resolve();
      });
    });
    /* oxlint-enable playwright/no-raw-locators */
  }

  async checkAndClickOnGHloginPopup(force = false) {
    const frameLocator = this.page.getByLabel("Login Required");
    try {
      await frameLocator.waitFor({ state: "visible", timeout: 2000 });
      await this.clickOnGHloginPopup();
    } catch (error) {
      if (force) throw error;
    }
  }

  async clickOnGHloginPopup() {
    const isLoginRequiredVisible = await this.uiHelper.isTextVisible(
      t["user-settings"][lang]["providerSettingsItem.buttonTitle.signIn"],
    );
    if (isLoginRequiredVisible) {
      await this.uiHelper.clickButton(
        t["user-settings"][lang]["providerSettingsItem.buttonTitle.signIn"],
      );
      await this.uiHelper.clickButton(t["core-components"][lang]["oauthRequestDialog.login"]);
      await this.checkAndReauthorizeGithubApp();
      await this.uiHelper.waitForLoginBtnDisappear();
    } else {
      console.log('"Log in" button is not visible. Skipping login popup actions.');
    }
  }

  getGitHub2FAOTP(userid: string): string {
    const ghUserId = process.env.GH_USER_ID;
    const ghUser2Id = process.env.GH_USER2_ID;
    const secrets: Record<string, string | undefined> = {};
    if (ghUserId !== undefined && ghUserId !== "") {
      secrets[ghUserId] = process.env.GH_2FA_SECRET;
    }
    if (ghUser2Id !== undefined && ghUser2Id !== "") {
      secrets[ghUser2Id] = process.env.GH_USER2_2FA_SECRET;
    }

    const secret = secrets[userid];
    if (secret === undefined || secret === "") {
      throw new Error("Invalid User ID");
    }

    return authenticator.generate(secret);
  }

  getGoogle2FAOTP(): string {
    const secret = process.env.GOOGLE_2FA_SECRET;
    if (secret === undefined || secret === "") {
      throw new Error("GOOGLE_2FA_SECRET is not set");
    }
    return authenticator.generate(secret);
  }

  async keycloakLogin(username: string, password: string) {
    await this.page.goto("/");
    await expect(
      this.page.locator(`p:has-text("${t["rhdh"][lang]["signIn.providers.oidc.message"]}")`),
    ).toBeVisible();

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return handleKeycloakPopupLogin(popup, username, password);
  }

  async githubLogin(username: string, password: string, twofactor: string) {
    await this.page.goto("/");
    await expect(
      this.page.locator(`p:has-text("${t["rhdh"][lang]["signIn.providers.github.message"]}")`),
    ).toBeVisible();

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return handleGitHubPopupLogin(popup, username, password, twofactor);
  }

  async githubLoginFromSettingsPage(username: string, password: string, twofactor: string) {
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
      this.uiHelper.clickButton(t["core-components"][lang]["oauthRequestDialog.login"]),
    ]);

    return handleGitHubPopupLogin(popup, username, password, twofactor);
  }

  async gitlabLogin(username: string, password: string) {
    await this.page.goto("/");
    await expect(
      this.page.locator(`p:has-text("${t["rhdh"][lang]["signIn.providers.gitlab.message"]}")`),
    ).toBeVisible();

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return handleGitlabPopupLogin(popup, username, password);
  }

  async MicrosoftAzureLogin(username: string, password: string) {
    await this.page.goto("/");
    await expect(
      this.page.locator(`p:has-text("${t["rhdh"][lang]["signIn.providers.microsoft.message"]}")`),
    ).toBeVisible();

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return handleMicrosoftAzurePopupLogin(popup, username, password);
  }

  async pingFederateLogin(username: string, password: string) {
    await this.page.goto("/");
    await expect(
      this.page.locator(`p:has-text("${t["rhdh"][lang]["signIn.providers.oidc.message"]}")`),
    ).toBeVisible();

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return handlePingFederatePopupLogin(popup, username, password);
  }
}
