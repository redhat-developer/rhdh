import * as fs from "fs";
import * as path from "path";

import { test, Browser, Cookie, expect, Page, TestInfo, Locator } from "@playwright/test";
import { authenticator } from "otplib";

import { getTranslations, getCurrentLanguage } from "../e2e/localization/locale";
import { startCoverageForPage, stopCoverageForPage } from "../support/coverage/test";
import { WAIT_OBJECTS } from "../support/page-objects/global-obj";
import { SETTINGS_PAGE_COMPONENTS } from "../support/page-objects/page-obj";
import { getErrorMessage } from "./errors";
import { UIhelper } from "./ui-helper";

const t = getTranslations();
const lang = getCurrentLanguage();

function parseAuthStateCookies(content: string): Cookie[] {
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("cookies" in parsed) ||
    !Array.isArray(parsed.cookies)
  ) {
    throw new TypeError("Invalid auth state: expected object with cookies array");
  }
  const rawCookies: unknown[] = parsed.cookies;
  const cookies = rawCookies.filter(
    (cookie): cookie is Cookie =>
      typeof cookie === "object" &&
      cookie !== null &&
      "name" in cookie &&
      typeof cookie.name === "string" &&
      "value" in cookie &&
      typeof cookie.value === "string",
  );
  if (cookies.length !== rawCookies.length) {
    throw new TypeError("Invalid auth state: cookies must have name and value");
  }
  return cookies;
}

export class Common {
  page: Page;
  uiHelper: UIhelper;
  private readonly authStateFileName = "authState.json";

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async loginAsGuest() {
    await this.page.goto("/");
    await this.waitForLoad(240000);
    // TODO - Remove it after https://issues.redhat.com/browse/RHIDP-2043. A Dynamic plugin for Guest Authentication Provider needs to be created
    this.page.on("dialog", async (dialog) => {
      console.log(`Dialog message: ${dialog.message()}`);
      await dialog.accept();
    });

    await this.uiHelper.verifyHeading(t["rhdh"][lang]["signIn.page.title"]);
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.guestProvider.enter"]);
    await this.uiHelper.waitForSideBarVisible();
  }

  async waitForLoad(timeout = 120000) {
    for (const item of Object.values(WAIT_OBJECTS)) {
      await this.page.waitForSelector(item, {
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
    await this.page.waitForSelector("#login_field");
    await this.page.fill("#login_field", userid);

    const password =
      userid === process.env.GH_USER_ID
        ? process.env.GH_USER_PASS
        : userid === process.env.GH_USER2_ID
          ? process.env.GH_USER2_PASS
          : undefined;
    if (!password) {
      throw new Error("Invalid User ID");
    }
    await this.page.fill("#password", password);

    await this.page.click('[value="Sign in"]');
    await this.page.fill("#app_totp", this.getGitHub2FAOTP(userid));
    test.setTimeout(130000);
    if (
      (await this.uiHelper.isTextVisible(
        "The two-factor code you entered has already been used",
      )) ||
      (await this.uiHelper.isTextVisible("too many codes have been submitted", 3000))
    ) {
      // GitHub TOTP codes cannot be reused within ~30s; wait for the next window.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 60_000);
      });
      await this.page.fill("#app_totp", this.getGitHub2FAOTP(userid));
    }

    await this.page.waitForLoadState("networkidle");
  }

  async logintoKeycloak(userid: string, password: string) {
    /* oxlint-disable playwright/no-raw-locators -- Keycloak login popup (third-party) */
    await new Promise<void>((resolve) => {
      this.page.once("popup", async (popup) => {
        await popup.waitForLoadState();
        await popup.locator("#username").fill(userid);
        await popup.locator("#password").fill(password);
        // Handle popup close during navigation (popup may close before navigation completes)
        try {
          await popup.locator("#kc-login").click({ timeout: 5000 });
        } catch (error) {
          // Popup likely closed - this is expected behavior
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
    await this.waitForLoad(240000);
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);
    await this.logintoKeycloak(userid, password);
    await this.uiHelper.waitForSideBarVisible();
  }

  async loginAsGithubUser(userid: string = process.env.GH_USER_ID ?? "") {
    const sessionFileName = `authState_${userid}.json`;

    // Check if a session file for this specific user already exists
    if (fs.existsSync(sessionFileName)) {
      // Load and reuse existing authentication state
      const cookies = parseAuthStateCookies(fs.readFileSync(sessionFileName, "utf-8"));
      await this.page.context().addCookies(cookies);
      console.log(`Reusing existing authentication state for user: ${userid}`);
      await this.page.goto("/");
      await this.waitForLoad(12000);
      await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);
      await this.checkAndReauthorizeGithubApp();
    } else {
      // Perform login if no session file exists, then save the state
      await this.logintoGithub(userid);
      await this.page.goto("/");
      await this.waitForLoad(240000);
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
    if (ghUserId) {
      secrets[ghUserId] = process.env.GH_2FA_SECRET;
    }
    if (ghUser2Id) {
      secrets[ghUser2Id] = process.env.GH_USER2_2FA_SECRET;
    }

    const secret = secrets[userid];
    if (!secret) {
      throw new Error("Invalid User ID");
    }

    return authenticator.generate(secret);
  }

  getGoogle2FAOTP(): string {
    const secret = process.env.GOOGLE_2FA_SECRET;
    if (!secret) {
      throw new Error("GOOGLE_2FA_SECRET is not set");
    }
    return authenticator.generate(secret);
  }

  async keycloakLogin(username: string, password: string) {
    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.oidc.message"]}")`,
    );

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    // Wait for the popup to appear
    await expect(async () => {
      await popup.waitForLoadState("domcontentloaded");
      expect(popup).toBeTruthy();
    }).toPass({
      intervals: [5_000, 10_000],
      timeout: 20 * 1000,
    });

    // Check if popup closes automatically (already logged in)
    try {
      await popup.waitForEvent("close", { timeout: 5000 });
      return "Already logged in";
    } catch {
      // Popup didn't close, proceed with login
    }

    /* oxlint-disable playwright/no-raw-locators -- Keycloak OIDC login popup (third-party) */
    try {
      await popup.locator("#username").click();
      await popup.locator("#username").fill(username);
      await popup.locator("#password").fill(password);
      await popup.locator("[name=login]").click({ timeout: 5000 });
      await popup.waitForEvent("close", { timeout: 2000 });
      return "Login successful";
    } catch (e) {
      const usernameError = popup.locator("id=input-error");
      if (await usernameError.isVisible()) {
        await popup.close();
        return "User does not exist";
      }
      throw e;
    }
    /* oxlint-enable playwright/no-raw-locators */
  }

  private async handleGitHubPopupLogin(
    popup: Page,
    username: string,
    password: string,
    twofactor: string,
  ): Promise<string> {
    await expect(async () => {
      await popup.waitForLoadState("domcontentloaded");
      expect(popup).toBeTruthy();
    }).toPass({
      intervals: [5_000, 10_000],
      timeout: 20 * 1000,
    });

    // Check if popup closes automatically
    try {
      await popup.waitForEvent("close", { timeout: 5000 });
      return "Already logged in";
    } catch {
      // Popup didn't close, proceed with login
    }

    /* oxlint-disable playwright/no-raw-locators -- GitHub login popup (third-party) */
    try {
      await popup.locator("#login_field").click({ timeout: 5000 });
      await popup.locator("#login_field").fill(username, { timeout: 5000 });
      const cookieLocator = popup.locator("#wcpConsentBannerCtrl");
      if (await cookieLocator.isVisible()) {
        await popup.click('button:has-text("Reject")', { timeout: 5000 });
      }
      await popup.locator("#password").click({ timeout: 5000 });
      await popup.locator("#password").fill(password, { timeout: 5000 });
      await popup
        .locator("[type='submit'][value='Sign in']:not(webauthn-status *)")
        .first()
        .click({ timeout: 5000 });
      const twofactorcode = authenticator.generate(twofactor);
      await popup.locator("#app_totp").click({ timeout: 5000 });
      await popup.locator("#app_totp").fill(twofactorcode, { timeout: 5000 });

      await popup.waitForEvent("close", { timeout: 20000 });
      return "Login successful";
    } catch (e) {
      const authorization = popup.locator("button.js-oauth-authorize-btn");
      if (await authorization.isVisible()) {
        await authorization.click();
        return "Login successful";
      }
      throw e;
    }
    /* oxlint-enable playwright/no-raw-locators */
  }

  async githubLogin(username: string, password: string, twofactor: string) {
    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.github.message"]}")`,
    );

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return this.handleGitHubPopupLogin(popup, username, password, twofactor);
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

    return this.handleGitHubPopupLogin(popup, username, password, twofactor);
  }

  private async handleGitlabPopupLogin(
    popup: Page,
    username: string,
    password: string,
  ): Promise<string> {
    await expect(async () => {
      await popup.waitForLoadState("domcontentloaded");
      expect(popup).toBeTruthy();
    }).toPass({
      intervals: [5_000, 10_000],
      timeout: 20 * 1000,
    });

    // Check if popup closes automatically
    try {
      await popup.waitForEvent("close", { timeout: 5000 });
      return "Already logged in";
    } catch {
      // Popup didn't close, proceed with login
    }

    /* oxlint-disable playwright/no-raw-locators -- GitLab login popup (third-party) */
    try {
      await popup.locator("#user_login").click({ timeout: 5000 });
      await popup.locator("#user_login").fill(username, { timeout: 5000 });
      await popup.locator("#user_password").click({ timeout: 5000 });
      await popup.locator("#user_password").fill(password, { timeout: 5000 });
      await popup.getByTestId("sign-in-button").click({ timeout: 5000 });

      // Wait for navigation after sign-in (either to 2FA, authorization, or close)
      await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {
        // Continue if load state check fails
      });

      // Handle 2FA if present
      const twoFactorInput = popup.locator("#user_otp_attempt");
      if (await twoFactorInput.isVisible({ timeout: 5000 })) {
        // If 2FA is required, we'll need to handle it
        // For now, we'll wait for the popup to close or authorization
        await popup.waitForEvent("close", { timeout: 20000 });
        return "Login successful";
      }

      // Wait for authorization button to appear and click it
      // Try data-testid first, then fallback to text-based selector
      const authorization = popup.getByTestId("authorize-button");
      const authorizationByText = popup.locator('button:has-text("Authorize")');

      // Wait for button to appear with retry logic
      let buttonToClick: Locator | undefined;
      await expect(async () => {
        // Check data-testid first
        if (await authorization.isVisible({ timeout: 2000 }).catch(() => false)) {
          buttonToClick = authorization;
          return true;
        }
        // Fallback to text-based selector
        if (await authorizationByText.isVisible({ timeout: 2000 }).catch(() => false)) {
          buttonToClick = authorizationByText;
          return true;
        }
        throw new Error("Authorization button not found");
      }).toPass({
        intervals: [1000, 2000],
        timeout: 15000,
      });

      if (!buttonToClick) {
        throw new Error("Failed to find authorization button");
      }

      const authorizeButton = buttonToClick;

      // Click on document/body first to potentially dismiss any overlays (similar to GitHub flow)
      await popup
        .getByRole("document")
        .click({ timeout: 1000 })
        .catch(() => {
          // Ignore if document click fails
        });

      // Wait for button to be enabled and clickable
      await authorizeButton.waitFor({ state: "visible", timeout: 5000 });
      await expect(authorizeButton).toBeEnabled({ timeout: 10000 });
      await authorizeButton.scrollIntoViewIfNeeded({ timeout: 5000 });

      try {
        await authorizeButton.click({ timeout: 5000 });
      } catch {
        // Force click fallback when overlay blocks the authorization button.
        // oxlint-disable-next-line playwright/no-force-option -- overlay dismissal is unreliable in CI
        await authorizeButton.click({ force: true, timeout: 5000 });
      }

      await popup.waitForEvent("close", { timeout: 20000 });
      return "Login successful";
    } catch (e) {
      // If popup close timeout, check if popup is already closed
      if (popup.isClosed()) {
        return "Login successful";
      }
      // Re-throw other errors
      throw e;
    }
    /* oxlint-enable playwright/no-raw-locators */
  }

  async gitlabLogin(username: string, password: string) {
    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.gitlab.message"]}")`,
    );

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    return this.handleGitlabPopupLogin(popup, username, password);
  }

  async MicrosoftAzureLogin(username: string, password: string) {
    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.microsoft.message"]}")`,
    );

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    // Wait for the popup to appear
    await expect(async () => {
      await popup.waitForLoadState("domcontentloaded");
      expect(popup).toBeTruthy();
    }).toPass({
      intervals: [5_000, 10_000],
      timeout: 20 * 1000,
    });

    // Check if popup closes automatically (already logged in)
    try {
      await popup.waitForEvent("close", { timeout: 5000 });
      return "Already logged in";
    } catch {
      // Popup didn't close, proceed with login
    }

    /* oxlint-disable playwright/no-raw-locators -- Microsoft Azure login popup (third-party) */
    try {
      await popup.locator("[name=loginfmt]").click();
      await popup.locator("[name=loginfmt]").fill(username, { timeout: 5000 });
      await popup.locator('[type=submit]:has-text("Next")').click({ timeout: 5000 });

      await popup.locator("[name=passwd]").click();
      await popup.locator("[name=passwd]").fill(password, { timeout: 5000 });
      await popup.locator('[type=submit]:has-text("Sign in")').click({ timeout: 5000 });
      await popup.locator('[type=button]:has-text("No")').click({ timeout: 15000 });
      return "Login successful";
    } catch (e) {
      const usernameError = popup.locator("id=usernameError");
      if (await usernameError.isVisible()) {
        return "User does not exist";
      }
      throw e;
    }
    /* oxlint-enable playwright/no-raw-locators */
  }

  async pingFederateLogin(username: string, password: string) {
    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.oidc.message"]}")`,
    );

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]),
    ]);

    // Wait for the popup to appear
    await expect(async () => {
      await popup.waitForLoadState("domcontentloaded");
      expect(popup).toBeTruthy();
    }).toPass({
      intervals: [5_000, 10_000],
      timeout: 20 * 1000,
    });

    // Check if popup closes automatically (already logged in)
    try {
      await popup.waitForEvent("close", { timeout: 5000 });
      return "Already logged in";
    } catch {
      // Popup didn't close, proceed with login
    }

    /* oxlint-disable playwright/no-raw-locators -- PingFederate login popup (third-party) */
    try {
      // Fill in username
      await popup.locator("#username").click();
      await popup.locator("#username").fill(username, { timeout: 5000 });

      // Fill in password
      await popup.locator("#password").click();
      await popup.locator("#password").fill(password, { timeout: 5000 });

      // Click sign in/login button (PingFederate uses id="signOnButton")
      await popup.locator("#signOnButton").click({ timeout: 5000 });

      // Click "Allow" button for scope authorization/consent
      await popup.locator("#allowButton").click({ timeout: 10000 });

      await popup.waitForEvent("close", { timeout: 2000 });
      return "Login successful";
    } catch (e) {
      // Check for login error indicators
      const errorElement = popup.locator(".ping-error, .error, [role=alert]");
      if (await errorElement.isVisible()) {
        await popup.close();
        return "Login failed - invalid credentials";
      }
      throw e;
    }
    /* oxlint-enable playwright/no-raw-locators */
  }
}

// Creates an isolated browser context for tests that share a page via beforeAll
// instead of using the built-in { page } fixture. Video recording must be configured
// here explicitly because the use.video option in playwright.config.ts only applies
// to the built-in fixtures, not to manually created contexts.
//
// Coverage is started automatically so specs that bypass the { page } fixture
// still participate in V8 JS coverage collection (RHIDP-13243).
// Call teardownBrowser() in afterAll to flush coverage and close the page.
export async function setupBrowser(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    // only record video when the test block is being retried
    ...(testInfo.retry > 0 && {
      recordVideo: {
        dir: `test-results/${path
          .parse(testInfo.file)
          .name.replace(".spec", "")}/${testInfo.titlePath[1]}`,
        size: { width: 1280, height: 720 },
      },
    }),
  });
  const page = await context.newPage();
  await startCoverageForPage(page);

  return { page, context };
}

// Flush V8 JS coverage collected during the test run and close the page.
// Pair with setupBrowser() in afterAll to ensure coverage data is written.
export async function teardownBrowser(page: Page, testInfo: TestInfo): Promise<void> {
  await stopCoverageForPage(page, testInfo);
  await page.close();
}
