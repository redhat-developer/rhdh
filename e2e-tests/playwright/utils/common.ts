import { UIhelper } from "./ui-helper";
import { authenticator } from "otplib";
import { test, Browser, expect, Page, TestInfo } from "@playwright/test";
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

  async logintoKeycloak(userid: string, password: string) {
    await new Promise<void>((resolve) => {
      this.page.once("popup", async (popup) => {
        await popup.waitForLoadState();
        await popup.locator("#username").fill(userid);
        await popup.locator("#password").fill(password);
        await popup.locator("#kc-login").click();
        resolve();
      });
    });
  }

  async loginAsKeycloakUser(
    userid: string = process.env.GH_USER_ID,
    password: string = process.env.GH_USER_PASS,
  ) {
    await this.page.goto("/");
    await this.waitForLoad(240000);
    await this.uiHelper.clickButton(t["core-components"][lang]["signIn.title"]);
    await this.logintoKeycloak(userid, password);
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

    if (popup.url().startsWith(process.env.BASE_URL)) {
      // an active rhsso session is already logged in and the popup will automatically close
      return "Already logged in";
    } else {
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

    if (popup.url().startsWith(process.env.BASE_URL)) {
      // an active rhsso session is already logged in and the popup will automatically close
      return "Already logged in";
    } else {
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

    if (popup.url().startsWith(process.env.BASE_URL)) {
      // an active microsoft session is already logged in and the popup will automatically close
      return "Already logged in";
    } else {
      try {
        await popup.locator("[name=loginfmt]").click();
        await popup
          .locator("[name=loginfmt]")
          .fill(username, { timeout: 5000 });
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
}

export async function setupBrowser(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    recordVideo: {
      dir: `test-results/${path
        .parse(testInfo.file)
        .name.replace(".spec", "")}/${testInfo.titlePath[1]}`,
      size: { width: 1920, height: 1080 },
    },
  });
  const page = await context.newPage();
  return { page, context };
}
