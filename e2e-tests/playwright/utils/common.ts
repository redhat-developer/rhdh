import { UIhelper } from "./ui-helper";
import { authenticator } from "otplib";
import {
  test,
  Browser,
  expect,
  Page,
  TestInfo,
  Locator,
} from "@playwright/test";
import { SETTINGS_PAGE_COMPONENTS } from "../support/page-objects/page-obj";
import { WAIT_OBJECTS } from "../support/page-objects/global-obj";
import * as path from "path";
import * as fs from "fs";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

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
    await this.uiHelper.clickButton(
      t["core-components"][lang]["signIn.guestProvider.enter"],
    );
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

    switch (userid) {
      case process.env.GH_USER_ID:
        await this.page.fill("#password", process.env.GH_USER_PASS);
        break;
      case process.env.GH_USER2_ID:
        await this.page.fill("#password", process.env.GH_USER2_PASS);
        break;
      default:
        throw new Error("Invalid User ID");
    }

    await this.page.click('[value="Sign in"]');
    await this.page.fill("#app_totp", this.getGitHub2FAOTP(userid));
    test.setTimeout(130000);
    if (
      (await this.uiHelper.isTextVisible(
        "The two-factor code you entered has already been used",
      )) ||
      (await this.uiHelper.isTextVisible(
        "too many codes have been submitted",
        3000,
      ))
    ) {
      await this.page.waitForTimeout(60000);
      await this.page.fill("#app_totp", this.getGitHub2FAOTP(userid));
    }

    await this.page.waitForTimeout(3_000);
  }

  private async submitKeycloakCredentials(
    popup: Page,
    userid: string,
    password: string,
  ) {
    // Keycloak may still hold an SSO session from a previous login and close
    // the popup on its own without showing the login form, possibly a few
    // seconds after bouncing through the OIDC callback redirect.
    try {
      await popup.waitForLoadState("domcontentloaded");
      await popup.locator("#username").waitFor({ timeout: 15_000 });
    } catch (error) {
      if (popup.isClosed()) {
        return;
      }
      const closedLate = await popup
        .waitForEvent("close", { timeout: 3_000 })
        .then(
          () => true,
          () => false,
        );
      if (closedLate) {
        return;
      }
      throw error;
    }

    await popup.locator("#username").fill(userid);
    await popup.locator("#password").fill(password);
    // The popup closing is the real success signal, so register the listener
    // before submitting. A plain click waits for the OIDC redirect navigation
    // to finish, and that wait races the popup teardown — the flaky #kc-login
    // timeout seen across the suite when the redirect ran long. Fire the click
    // and treat a "target closed" rejection (popup gone mid-redirect) as the
    // expected end; the close event below decides success.
    const popupClosed = popup.waitForEvent("close", { timeout: 30_000 });
    // Registered above but only awaited below: if the click rethrows, nothing is
    // waiting on it and it rejects unhandled 30s later.
    popupClosed.catch(() => {});
    await popup
      .locator("#kc-login")
      .click({ timeout: 30_000 })
      .catch((error) => {
        if (!popup.isClosed()) {
          throw error;
        }
      });

    // A rejected password leaves the popup open on the login form. Without this
    // the helper returns as if it had signed in and the failure surfaces later
    // as a bare sidebar timeout, with Keycloak's reason nowhere in the report.
    try {
      await popupClosed;
    } catch (error) {
      const reason = await popup
        .locator("#input-error")
        .textContent({ timeout: 1_000 })
        .catch(() => null);
      throw new Error(
        reason
          ? `Keycloak rejected the sign-in: ${reason.trim()}`
          : "Keycloak did not complete the sign-in: the popup stayed open",
      );
    }
  }

  async loginAsKeycloakUser(
    userid: string = process.env.GH_USER_ID,
    password: string = process.env.GH_USER_PASS,
  ) {
    await this.page.goto("/");
    await this.waitForLoad(240000);
    // Scope the Sign In click to the OIDC provider card. Today the guest card's
    // button reads "Enter", so an unscoped click already resolved here — this
    // keeps it right if `signInPage` ever lists two providers that both read
    // "Sign In". Each card is a list item in the provider grid.
    const signInTitle = t["core-components"][lang]["signIn.title"];
    const oidcCard = this.page
      .getByRole("listitem")
      .filter({ hasText: t["rhdh"][lang]["signIn.providers.oidc.message"] })
      .filter({ has: this.page.getByRole("button", { name: signInTitle }) });
    await oidcCard.waitFor({ timeout: 30_000 });
    // Register the popup listener before clicking: the provider opens it
    // synchronously, so a listener attached afterwards misses the event and
    // the login hangs until the test times out.
    const [popup] = await Promise.all([
      this.page.waitForEvent("popup", { timeout: 30_000 }),
      oidcCard.getByRole("button", { name: signInTitle }).click(),
    ]);
    await this.submitKeycloakCredentials(popup, userid, password);
    await this.uiHelper.waitForSideBarVisible();
  }

  async loginAsGithubUser(userid: string = process.env.GH_USER_ID) {
    const sessionFileName = `authState_${userid}.json`;

    // Check if a session file for this specific user already exists
    if (fs.existsSync(sessionFileName)) {
      // Load and reuse existing authentication state
      const cookies = JSON.parse(
        fs.readFileSync(sessionFileName, "utf-8"),
      ).cookies;
      await this.page.context().addCookies(cookies);
      console.log(`Reusing existing authentication state for user: ${userid}`);
      await this.page.goto("/");
      await this.waitForLoad(12000);
      await this.uiHelper.clickButton(
        t["core-components"][lang]["signIn.title"],
      );
      await this.checkAndReauthorizeGithubApp();
    } else {
      // Perform login if no session file exists, then save the state
      await this.logintoGithub(userid);
      await this.page.goto("/");
      await this.waitForLoad(240000);
      await this.uiHelper.clickButton(
        t["core-components"][lang]["signIn.title"],
      );
      await this.checkAndReauthorizeGithubApp();
      await this.uiHelper.waitForSideBarVisible();
      await this.page.context().storageState({ path: sessionFileName });
      console.log(`Authentication state saved for user: ${userid}`);
    }
  }

  async checkAndReauthorizeGithubApp() {
    await new Promise<void>((resolve) => {
      this.page.once("popup", async (popup) => {
        await popup.waitForLoadState();

        // Check for popup closure for up to 10 seconds before proceeding
        for (let attempts = 0; attempts < 10 && !popup.isClosed(); attempts++) {
          await this.page.waitForTimeout(1000); // Using page here because if the popup closes automatically, it throws an error during the wait
        }

        const locator = popup.locator("button.js-oauth-authorize-btn");
        if (!popup.isClosed() && (await locator.isVisible())) {
          await popup.locator("body").click();
          await locator.waitFor();
          await locator.click();
        }
        resolve();
      });
    });
  }

  async googleSignIn(email: string) {
    await new Promise<void>((resolve) => {
      this.page.once("popup", async (popup) => {
        await popup.waitForLoadState();
        const locator = popup
          .getByRole("link", { name: email, exact: false })
          .first();
        await popup.waitForTimeout(3000);
        await locator.waitFor({ state: "visible" });
        // eslint-disable-next-line playwright/no-force-option
        await locator.click({ force: true });
        await popup.waitForTimeout(3000);

        await popup.locator("[name=Passwd]").fill(process.env.GOOGLE_USER_PASS);
        await popup.locator("[name=Passwd]").press("Enter");
        await popup.waitForTimeout(3500);
        await popup.locator("[name=totpPin]").fill(this.getGoogle2FAOTP());
        await popup.locator("[name=totpPin]").press("Enter");
        await popup
          .getByRole("button", { name: /Continue|Weiter/ })
          .click({ timeout: 60000 });
        resolve();
      });
    });
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
      await this.uiHelper.clickButton(
        t["core-components"][lang]["oauthRequestDialog.login"],
      );
      await this.checkAndReauthorizeGithubApp();
      await this.uiHelper.waitForLoginBtnDisappear();
    } else {
      console.log(
        '"Log in" button is not visible. Skipping login popup actions.',
      );
    }
  }

  getGitHub2FAOTP(userid: string): string {
    const secrets: { [key: string]: string | undefined } = {
      [process.env.GH_USER_ID]: process.env.GH_2FA_SECRET,
      [process.env.GH_USER2_ID]: process.env.GH_USER2_2FA_SECRET,
    };

    const secret = secrets[userid];
    if (!secret) {
      throw new Error("Invalid User ID");
    }

    return authenticator.generate(secret);
  }

  getGoogle2FAOTP(): string {
    const secret = process.env.GOOGLE_2FA_SECRET;
    return authenticator.generate(secret);
  }

  async keycloakLogin(username: string, password: string) {
    let popup: Page;
    this.page.once("popup", (asyncnewPage) => {
      popup = asyncnewPage;
    });

    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.oidc.message"]}")`,
    );
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);

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
      } else {
        throw e;
      }
    }
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
      } else {
        throw e;
      }
    }
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

  async githubLoginFromSettingsPage(
    username: string,
    password: string,
    twofactor: string,
  ) {
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
      this.uiHelper.clickButton(
        t["core-components"][lang]["oauthRequestDialog.login"],
      ),
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

    try {
      await popup.locator("#user_login").click({ timeout: 5000 });
      await popup.locator("#user_login").fill(username, { timeout: 5000 });
      await popup.locator("#user_password").click({ timeout: 5000 });
      await popup.locator("#user_password").fill(password, { timeout: 5000 });
      await popup.getByTestId("sign-in-button").click({ timeout: 5000 });

      // Wait for navigation after sign-in (either to 2FA, authorization, or close)
      await popup
        .waitForLoadState("domcontentloaded", { timeout: 10000 })
        .catch(() => {
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
      let buttonToClick: Locator | null = null;
      await expect(async () => {
        // Check data-testid first
        if (
          await authorization.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          buttonToClick = authorization;
          return true;
        }
        // Fallback to text-based selector
        if (
          await authorizationByText
            .isVisible({ timeout: 2000 })
            .catch(() => false)
        ) {
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

      // Click on document/body first to potentially dismiss any overlays (similar to GitHub flow)
      await popup
        .getByRole("document")
        .click({ timeout: 1000 })
        .catch(() => {
          // Ignore if document click fails
        });

      // Wait for button to be enabled and clickable
      await buttonToClick.waitFor({ state: "visible", timeout: 5000 });
      await expect(buttonToClick).toBeEnabled({ timeout: 10000 });
      await buttonToClick.scrollIntoViewIfNeeded({ timeout: 5000 });
      // Small delay to ensure any animations/transitions complete
      await popup.waitForTimeout(1000);

      try {
        await buttonToClick.click({ timeout: 5000 });
      } catch {
        // If regular click fails, try force click
        // eslint-disable-next-line playwright/no-force-option
        await buttonToClick.click({ force: true, timeout: 5000 });
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
    let popup: Page;
    this.page.once("popup", (asyncnewPage) => {
      popup = asyncnewPage;
    });

    await this.page.goto("/");
    await this.page.waitForSelector(
      `p:has-text("${t["rhdh"][lang]["signIn.providers.microsoft.message"]}")`,
    );
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);

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

    try {
      await popup.locator("[name=loginfmt]").click();
      await popup.locator("[name=loginfmt]").fill(username, { timeout: 5000 });
      await popup
        .locator('[type=submit]:has-text("Next")')
        .click({ timeout: 5000 });

      await popup.locator("[name=passwd]").click();
      await popup.locator("[name=passwd]").fill(password, { timeout: 5000 });
      await popup
        .locator('[type=submit]:has-text("Sign in")')
        .click({ timeout: 5000 });
      await popup
        .locator('[type=button]:has-text("No")')
        .click({ timeout: 15000 });
      return "Login successful";
    } catch (e) {
      const usernameError = popup.locator("id=usernameError");
      if (await usernameError.isVisible()) {
        return "User does not exist";
      } else {
        throw e;
      }
    }
  }
}

// Creates an isolated browser context for tests that share a page via beforeAll
// instead of using the built-in { page } fixture. Video recording must be configured
// here explicitly because the use.video option in playwright.config.ts only applies
// to the built-in fixtures, not to manually created contexts.
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

  return { page, context };
}
