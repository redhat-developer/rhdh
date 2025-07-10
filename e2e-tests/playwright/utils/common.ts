import { UIhelper } from "./ui-helper";
import { authenticator } from "otplib";
import { test, Browser, expect, Page, TestInfo } from "@playwright/test";
import { SETTINGS_PAGE_COMPONENTS } from "../support/pageObjects/page-obj";
import { WAIT_OBJECTS } from "../support/pageObjects/global-obj";
import path from "path";
import fs from "fs";
import { APIHelper } from "./api-helper";
import { GroupEntity, UserEntity } from "@backstage/catalog-model";

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

    await this.uiHelper.verifyHeading("Select a sign-in method");
    await this.uiHelper.clickButton("Enter");
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
    await this.uiHelper.clickButton(SETTINGS_PAGE_COMPONENTS.userSettingsMenu);
    await this.uiHelper.clickButton(SETTINGS_PAGE_COMPONENTS.signOut);
    await this.uiHelper.verifyHeading("Select a sign-in method");
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
    await this.uiHelper.clickButton("Sign In");
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
      await this.uiHelper.clickButton("Sign In");
      await this.checkAndReauthorizeGithubApp();
    } else {
      // Perform login if no session file exists, then save the state
      await this.logintoGithub(userid);
      await this.page.goto("/");
      await this.waitForLoad(240000);
      await this.uiHelper.clickButton("Sign In");
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
    const isLoginRequiredVisible = await this.uiHelper.isTextVisible("Sign in");
    if (isLoginRequiredVisible) {
      await this.uiHelper.clickButton("Sign in");
      await this.uiHelper.clickButton("Log in");
      await this.checkAndReauthorizeGithubApp();
      await this.uiHelper.waitForLoginBtnDisappear();
    } else {
      console.log(
        '"Log in" button is not visible. Skipping login popup actions.',
      );
    }
  }

  private async getGroupLinksByLabel(label: string): Promise<string[]> {
    const section = this.page.locator(`p:has-text("${label}")`).first();
    await section.waitFor({ state: "visible" });
    return await section.locator("..")
      .locator("a")
      .allInnerTexts();
  }

  async getParentGroupsDisplayed(): Promise<string[]> {
    return await this.getGroupLinksByLabel("Parent Group");
  }

  async getChildGroupsDisplayed(): Promise<string[]> {
    return await this.getGroupLinksByLabel("Child Groups");
  }

  async githubLoginPopUpModal(context, username: string, password: string, otpSecret: string): Promise<void> {
    const [githubPage] = await Promise.all([
      context.waitForEvent('page'),
    ]);
    await githubPage.waitForSelector('input[name="login"], input[aria-label="Username or email address"]', { timeout: 10000 });
    await githubPage.fill('input[name="login"], input[aria-label="Username or email address"]', username);
    await githubPage.waitForSelector('input[name="password"]', { timeout: 10000 });
    await githubPage.fill('input[name="password"]', password);
    await githubPage.waitForSelector('button[type="submit"], input[type="submit"]', { timeout: 10000 });
    await githubPage.click('button[type="submit"], input[type="submit"]');
    // OTP
    const otpSelector = await this.findOtpSelector(githubPage);
    if (otpSelector) {
      if (githubPage.isClosed()) return;
      await githubPage.waitForSelector(otpSelector, { timeout: 10000 });
      if (githubPage.isClosed()) return;
      const otp = authenticator.generate(otpSecret);
      await githubPage.fill(otpSelector, otp);
      if (githubPage.isClosed()) return;
      await Promise.race([
        githubPage.waitForEvent('close', { timeout: 20000 }),
        githubPage.click('button[type="submit"], input[type="submit"]'),
      ]);
    } else {
      await githubPage.waitForEvent('close', { timeout: 20000 });
    }
  }

  private async findOtpSelector(page): Promise<string> {
    const selectors = ['input[name="otp"]', '#app_totp'];
    for (const selector of selectors) {
      try {
        await page.locator(selector).waitFor({ state: 'visible', timeout: 10000 });
        return selector;
      } catch (err) {
        console.debug(`Selector ${selector} not visible yet, continuing…`);
      }
    }
    throw new Error('OTP field not found on the page within 10 s');
  }

  getGitHub2FAOTP(userid: string): string {
    switch (userid) {
      case process.env.GH_USER_ID:
        return authenticator.generate(process.env.GH_2FA_SECRET);
      case process.env.GH_USER2_ID:
        return authenticator.generate(process.env.GH_USER2_2FA_SECRET);
      default:
        throw new Error("Invalid User ID");
    }
  }

  getGoogle2FAOTP(): string {
    return authenticator.generate(process.env.GOOGLE_2FA_SECRET);
  }

  async keycloakLogin(username: string, password: string) {
    let popup: Page;
    this.page.once("popup", (asyncnewPage) => {
      popup = asyncnewPage;
    });

    await this.page.goto("/");
    await this.page.waitForSelector('p:has-text("Sign in using OIDC")');
    await this.uiHelper.clickButton("Sign In");

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
        await popup.locator("[type='submit']").click({ timeout: 5000 });
        const twofactorcode = authenticator.generate(twofactor);
        await popup.locator("#app_totp").click({ timeout: 5000 });
        await popup.locator("#app_totp").fill(twofactorcode, { timeout: 5000 });

        await popup.waitForEvent("close", { timeout: 20000 });
        return "Login successful";
      } catch (e) {
        const authorization = popup.locator("button.js-oauth-authorize-btn");
        if (await authorization.isVisible()) {
          authorization.click();
          return "Login successful";
        } else {
          throw e;
        }
      }
    }
  }

  async githubLogin(username: string, password: string, twofactor: string) {
    await this.page.goto("/");
    await this.page.waitForSelector('p:has-text("Sign in using GitHub")');

    const [popup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.uiHelper.clickButton("Sign In"),
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
      this.page.getByTitle("Sign in to GitHub").click(),
      this.uiHelper.clickButton("Log in"),
    ]);

    return this.handleGitHubPopupLogin(popup, username, password, twofactor);
  }
  async MicrosoftAzureLogin(username: string, password: string) {
    let popup: Page;
    this.page.once("popup", (asyncnewPage) => {
      popup = asyncnewPage;
    });

    await this.page.goto("/");
    await this.page.waitForSelector('p:has-text("Sign in using Microsoft")');
    await this.uiHelper.clickButton("Sign In");

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

  async GetParentGroupDisplayed(): Promise<string[]> {
    await this.page.waitForSelector("p:has-text('Parent Group')");
    const parent = await this.page
      .locator("p:has-text('Parent Group')")
      .locator("..");
    const group = await parent.locator("a").allInnerTexts();
    return group;
  }

  async GetChildGroupsDisplayed(): Promise<string[]> {
    await this.page.waitForSelector("p:has-text('Child Groups')");
    const parent = await this.page
      .locator("p:has-text('Child Groups')")
      .locator("..");
    const groups = await parent.locator("a").allInnerTexts();
    return groups;
  }

  async GetMembersOfGroupDisplayed(): Promise<string[]> {
    await this.page.waitForSelector(`//div[contains(., "Members")]/..`);
    const membersCard = this.page
      .locator(
        `//div[contains(@class,'MuiCardHeader-root') and descendant::text()[contains(., "Members")] ]/.. // a[@data-testid='user-link']`,
      )
      .allInnerTexts();
    return membersCard;
  }

  async GoToGroupPageAndGetDisplayedData(groupDisplayName: string) {
    await this.page.goto(
      "/catalog?filters%5Bkind%5D=group&filters%5Buser%5D=all",
    );
    await expect(this.page.getByRole("heading", { level: 1 })).toHaveText(
      "My Org Catalog",
    );

    await this.uiHelper.clickLink(groupDisplayName);
    await this.uiHelper.verifyHeading(groupDisplayName);

    const childGroups = await this.GetChildGroupsDisplayed();
    const parentGroup = await this.GetParentGroupDisplayed();
    const groupMembers = await this.GetMembersOfGroupDisplayed();
    return {
      childGroups,
      parentGroup,
      groupMembers,
    };
  }

  async UnregisterUserEntityFromCatalog(user: string, apiToken: string) {
    const api = new APIHelper();
    api.UseStaticToken(apiToken);
    await api.deleteUserEntityFromAPI(user);
  }

  async UnregisterGroupEntityFromCatalog(group: string, apiToken: string) {
    const api = new APIHelper();
    api.UseStaticToken(apiToken);
    await api.deleteGroupEntityFromAPI(group);
  }

  async CheckGroupIsShowingInCatalog(groups: string[]) {
    await this.page.goto(
      "/catalog?filters%5Bkind%5D=group&filters%5Buser%5D=all",
    );
    await expect(this.page.getByRole("heading", { level: 1 })).toHaveText(
      "My Org Catalog",
    );
    await this.uiHelper.verifyHeading("All groups");
    await this.uiHelper.verifyCellsInTable(groups);
  }

  async CheckUserIsShowingInCatalog(users: string[]) {
    await this.page.goto(
      "/catalog?filters%5Bkind%5D=user&filters%5Buser%5D=all",
    );
    await expect(this.page.getByRole("heading", { level: 1 })).toHaveText(
      "My Org Catalog",
    );
    await this.uiHelper.verifyHeading("All user");
    await this.uiHelper.verifyCellsInTable(users);
  }

  async CheckUserIsIngestedInCatalog(users: string[], apiToken: string) {
    const api = new APIHelper();
    api.UseStaticToken(apiToken);
    const response = await api.getAllCatalogUsersFromAPI();
    console.log(`Users currently in catalog: ${JSON.stringify(response)}`);
    const catalogUsers: UserEntity[] =
      response && response.items ? response.items : [];
    expect(catalogUsers.length).toBeGreaterThan(0);
    const catalogUsersDisplayNames: string[] = catalogUsers
      .filter((u) => u.spec.profile && u.spec.profile.displayName)
      .map((u) => u.spec.profile.displayName);
    console.log(
      `Checking ${JSON.stringify(catalogUsersDisplayNames)} contains users ${JSON.stringify(users)}`,
    );
    const hasAllElems = users.every((elem) =>
      catalogUsersDisplayNames.includes(elem),
    );
    return hasAllElems;
  }

  async CheckGroupIsIngestedInCatalog(groups: string[], apiToken: string) {
    const api = new APIHelper();
    api.UseStaticToken(apiToken);
    const response = await api.getAllCatalogGroupsFromAPI();
    console.log(`Groups currently in catalog: ${JSON.stringify(response)}`);
    const catalogGroups: GroupEntity[] =
      response && response.items ? response.items : [];
    expect(catalogGroups.length).toBeGreaterThan(0);
    const catalogGroupsDisplayNames: string[] = catalogGroups
      .filter((u) => u.spec.profile && u.spec.profile.displayName)
      .map((u) => u.spec.profile.displayName);
    console.log(
      `Checking ${JSON.stringify(catalogGroupsDisplayNames)} contains groups ${JSON.stringify(groups)}`,
    );
    const hasAllElems = groups.every((elem) =>
      catalogGroupsDisplayNames.includes(elem),
    );
    return hasAllElems;
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

export type EntityWithDisplay = { spec?: { profile?: { displayName?: string } } };

export class CatalogVerifier {
  private api: APIHelper;

  constructor(token: string) {
    this.api = new APIHelper();
    this.api.UseStaticToken(token);
  }

  async assertUsersInCatalog(expected: string[]): Promise<void> {
    await this.assertEntities(
      () => this.api.getAllCatalogUsersFromAPI(),
      expected,
      'users',
    );
  }

  async assertGroupsInCatalog(expected: string[]): Promise<void> {
    await this.assertEntities(
      () => this.api.getAllCatalogGroupsFromAPI(),
      expected,
      'groups',
    );
  }

  private async assertEntities(
    fetch: () => Promise<{ items?: EntityWithDisplay[] }>,
    expected: string[],
    label: string,
  ): Promise<void> {
    const { items = [] } = await fetch();

    expect(items.length).toBeGreaterThan(0);

    const displayNames = items
      .flatMap(e => e.spec?.profile?.displayName ?? []);

    const catalogSet = new Set(displayNames);
    const missing = expected.filter(name => !catalogSet.has(name));

    console.info(
      `Catalog ${label}: [${displayNames.join(', ')}] – expecting [${expected.join(', ')}]`,
    );

    expect(missing, `Missing ${label}: ${missing.join(', ')}`).toHaveLength(0);
  }
}
