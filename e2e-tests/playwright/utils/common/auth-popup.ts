import { expect, type Locator, type Page } from "@playwright/test";
import { authenticator } from "otplib";

async function waitForAuthPopupReady(popup: Page): Promise<void> {
  await expect(async () => {
    await popup.waitForLoadState("domcontentloaded");
    expect(popup).toBeTruthy();
  }).toPass({
    intervals: [5_000, 10_000],
    timeout: 20 * 1000,
  });
}

async function tryAlreadyLoggedIn(popup: Page): Promise<string | null> {
  try {
    await popup.waitForEvent("close", { timeout: 5000 });
    return "Already logged in";
  } catch {
    return null;
  }
}

export async function handleGitHubPopupLogin(
  popup: Page,
  username: string,
  password: string,
  twofactor: string,
): Promise<string> {
  await waitForAuthPopupReady(popup);
  const alreadyLoggedIn = await tryAlreadyLoggedIn(popup);
  if (alreadyLoggedIn !== null) {
    return alreadyLoggedIn;
  }

  /* oxlint-disable playwright/no-raw-locators -- Intentional divergence: third-party GitHub login popup */
  try {
    await popup.locator("#login_field").click({ timeout: 5000 });
    await popup.locator("#login_field").fill(username, { timeout: 5000 });
    const cookieLocator = popup.locator("#wcpConsentBannerCtrl");
    if (await cookieLocator.isVisible()) {
      await popup.getByRole("button", { name: "Reject" }).click({ timeout: 5000 });
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

async function findGitlabAuthorizeButton(popup: Page): Promise<Locator> {
  /* oxlint-disable playwright/no-raw-locators -- Intentional divergence: third-party GitLab authorize popup */
  const authorization = popup.getByTestId("authorize-button");
  const authorizationByText = popup.getByRole("button", { name: "Authorize" });
  /* oxlint-enable playwright/no-raw-locators */

  let buttonToClick: Locator | undefined;
  await expect(async () => {
    if (await authorization.isVisible({ timeout: 2000 }).catch(() => false)) {
      buttonToClick = authorization;
      return true;
    }
    if (await authorizationByText.isVisible({ timeout: 2000 }).catch(() => false)) {
      buttonToClick = authorizationByText;
      return true;
    }
    throw new Error("Authorization button not found");
  }).toPass({
    intervals: [1000, 2000],
    timeout: 15000,
  });

  if (buttonToClick === undefined) {
    throw new Error("Failed to find authorization button");
  }
  return buttonToClick;
}

async function clickGitlabAuthorizeButton(popup: Page, authorizeButton: Locator): Promise<void> {
  await popup
    .getByRole("document")
    .click({ timeout: 1000 })
    .catch(() => {});

  await authorizeButton.waitFor({ state: "visible", timeout: 5000 });
  await expect(authorizeButton).toBeEnabled({ timeout: 10000 });
  await authorizeButton.scrollIntoViewIfNeeded({ timeout: 5000 });

  try {
    await authorizeButton.click({ timeout: 5000 });
  } catch {
    // Intentional divergence: GitLab authorize overlay dismissal is unreliable in CI.
    // oxlint-disable-next-line playwright/no-force-option
    await authorizeButton.click({ force: true, timeout: 5000 });
  }
}

export async function handleGitlabPopupLogin(
  popup: Page,
  username: string,
  password: string,
): Promise<string> {
  await waitForAuthPopupReady(popup);
  const alreadyLoggedIn = await tryAlreadyLoggedIn(popup);
  if (alreadyLoggedIn !== null) {
    return alreadyLoggedIn;
  }

  /* oxlint-disable playwright/no-raw-locators -- Intentional divergence: third-party GitLab login popup */
  try {
    await popup.locator("#user_login").click({ timeout: 5000 });
    await popup.locator("#user_login").fill(username, { timeout: 5000 });
    await popup.locator("#user_password").click({ timeout: 5000 });
    await popup.locator("#user_password").fill(password, { timeout: 5000 });
    await popup.getByTestId("sign-in-button").click({ timeout: 5000 });

    await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});

    const twoFactorInput = popup.locator("#user_otp_attempt");
    if (await twoFactorInput.isVisible({ timeout: 5000 })) {
      await popup.waitForEvent("close", { timeout: 20000 });
      return "Login successful";
    }

    const authorizeButton = await findGitlabAuthorizeButton(popup);
    await clickGitlabAuthorizeButton(popup, authorizeButton);

    await popup.waitForEvent("close", { timeout: 20000 });
    return "Login successful";
  } catch (e) {
    if (popup.isClosed()) {
      return "Login successful";
    }
    throw e;
  }
  /* oxlint-enable playwright/no-raw-locators */
}

async function fillMicrosoftCredentials(
  popup: Page,
  username: string,
  password: string,
): Promise<string> {
  /* oxlint-disable playwright/no-raw-locators -- Intentional divergence: third-party Microsoft Azure login popup */
  try {
    await popup.locator("[name=loginfmt]").click();
    await popup.locator("[name=loginfmt]").fill(username, { timeout: 5000 });
    await popup.getByRole("button", { name: "Next" }).click({ timeout: 5000 });

    await popup.locator("[name=passwd]").click();
    await popup.locator("[name=passwd]").fill(password, { timeout: 5000 });
    await popup.getByRole("button", { name: "Sign in" }).click({ timeout: 5000 });
    await popup.getByRole("button", { name: "No" }).click({ timeout: 15000 });
    if (!popup.isClosed()) {
      await popup.waitForEvent("close", { timeout: 20_000 });
    }
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

export async function handleMicrosoftAzurePopupLogin(
  popup: Page,
  username: string,
  password: string,
): Promise<string> {
  await waitForAuthPopupReady(popup);
  const alreadyLoggedIn = await tryAlreadyLoggedIn(popup);
  if (alreadyLoggedIn !== null) {
    return alreadyLoggedIn;
  }
  return fillMicrosoftCredentials(popup, username, password);
}

async function fillPingFederateCredentials(
  popup: Page,
  username: string,
  password: string,
): Promise<string> {
  /* oxlint-disable playwright/no-raw-locators -- Intentional divergence: third-party PingFederate login popup */
  try {
    const usernameField = popup.locator("#username");
    const passwordField = popup.locator("#password");
    const signOnButton = popup.locator("#signOnButton, button[type='submit'], #submit");
    const allowButton = popup.locator("#allowButton");

    await expect(usernameField).toBeVisible({ timeout: 30_000 });
    await usernameField.fill(username);
    await expect(passwordField).toBeVisible({ timeout: 10_000 });
    await passwordField.fill(password);
    await expect(signOnButton.first()).toBeVisible({ timeout: 10_000 });
    await signOnButton.first().click();

    // Consent / allow is not always shown (already consented sessions).
    // Prefer waiting on the allow control or popup close rather than a fixed sleep.
    const allowWait = allowButton
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => "allow" as const)
      .catch(() => null);
    const closeWait = popup
      .waitForEvent("close", { timeout: 15_000 })
      .then(() => "closed" as const)
      .catch(() => null);
    const allowOrClosed = await Promise.race([allowWait, closeWait]);

    if (allowOrClosed === "allow") {
      await allowButton.click({ timeout: 10_000 });
    }
    if (allowOrClosed !== "closed" && !popup.isClosed()) {
      await popup.waitForEvent("close", { timeout: 90_000 });
    }
    return "Login successful";
  } catch (e) {
    const errorElement = popup.locator(".ping-error, .error, [role=alert]");
    if (await errorElement.isVisible().catch(() => false)) {
      await popup.close();
      return "Login failed - invalid credentials";
    }
    throw e;
  }
  /* oxlint-enable playwright/no-raw-locators */
}

export async function handlePingFederatePopupLogin(
  popup: Page,
  username: string,
  password: string,
): Promise<string> {
  await waitForAuthPopupReady(popup);
  const alreadyLoggedIn = await tryAlreadyLoggedIn(popup);
  if (alreadyLoggedIn !== null) {
    return alreadyLoggedIn;
  }
  return fillPingFederateCredentials(popup, username, password);
}

export async function handleKeycloakPopupLogin(
  popup: Page,
  username: string,
  password: string,
): Promise<string> {
  await waitForAuthPopupReady(popup);
  const alreadyLoggedIn = await tryAlreadyLoggedIn(popup);
  if (alreadyLoggedIn !== null) {
    return alreadyLoggedIn;
  }

  /* oxlint-disable playwright/no-raw-locators -- Intentional divergence: third-party Keycloak OIDC login popup */
  try {
    await popup.locator("#username").click();
    await popup.locator("#username").fill(username);
    await popup.locator("#password").fill(password);
    await popup.locator("[name=login]").click({ timeout: 5000 });
    await popup.waitForEvent("close", { timeout: 20_000 });
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
