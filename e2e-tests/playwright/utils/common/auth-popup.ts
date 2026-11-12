import { expect, type Page } from "@playwright/test";
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
