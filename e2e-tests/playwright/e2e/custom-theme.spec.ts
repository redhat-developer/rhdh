import { test, Page, TestInfo, expect } from "@playwright/test";
import { Common, setupBrowser } from "../utils/common";
import { ThemeVerifier } from "../utils/custom-theme/theme-verifier";
import {
  CUSTOM_FAVICON,
  CUSTOM_SIDEBAR_LOGO,
} from "../support/testData/custom-theme";
import { ThemeConstants } from "../data/theme-constants";

let page: Page;

test.describe("CustomTheme should be applied", () => {
  let common: Common;
  let themeVerifier: ThemeVerifier;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    themeVerifier = new ThemeVerifier(page);

    await common.loginAsGuest();
    await page.getByRole("button", { name: "Hide" }).click();
  });

  // eslint-disable-next-line no-empty-pattern
  test("Verify theme colors are applied and make screenshots", async ({}, testInfo: TestInfo) => {
    const themes = ThemeConstants.getThemes();

    for (const theme of themes) {
      await themeVerifier.setTheme(theme.name);
      await themeVerifier.verifyHeaderGradient(
        `none, linear-gradient(90deg, ${theme.headerColor1}, ${theme.headerColor2})`,
      );
      await themeVerifier.verifyBorderLeftColor(theme.navigationIndicatorColor);
      await themeVerifier.takeScreenshotAndAttach(
        `screenshots/custom-theme-${theme.name}-inspection.png`,
        testInfo,
        `custom-theme-${theme.name}-inspection`,
      );
      await themeVerifier.verifyPrimaryColors(theme.primaryColor);
    }
  });

  test("Verify that the RHDH favicon can be customized", async () => {
    expect(await page.locator("#dynamic-favicon").getAttribute("href")).toEqual(
      CUSTOM_FAVICON.LIGHT,
    );
  });

  test("Verify that RHDH CompanyLogo can be customized", async () => {
    await themeVerifier.setTheme("Light");

    expect(await page.getByTestId("home-logo").getAttribute("src")).toEqual(
      CUSTOM_SIDEBAR_LOGO.LIGHT,
    );

    await themeVerifier.setTheme("Dark");
    expect(await page.getByTestId("home-logo").getAttribute("src")).toEqual(
      CUSTOM_SIDEBAR_LOGO.DARK,
    );
  });

  test("Verify logo link", async () => {
    expect(
      await page
        .getByTestId("global-header-company-logo")
        .locator("a")
        .getAttribute("href"),
    ).toEqual("/");
    await page.getByTestId("global-header-company-logo").click();
    await expect(page).toHaveURL("/");
  });

  test("Verify that title for Backstage can be customized", async () => {
    await expect(page).toHaveTitle(/Red Hat Developer Hub/);
  });
});
