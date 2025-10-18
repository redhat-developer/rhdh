import { test, Page, TestInfo, expect } from "@playwright/test";
import { Common, setupBrowser } from "../utils/common";
import { ThemeVerifier } from "../utils/custom-theme/theme-verifier";
import {
  CUSTOM_FAVICON,
  CUSTOM_SIDEBAR_LOGO,
} from "../support/test-data/custom-theme";
import { ThemeConstants } from "../data/theme-constants";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();
let page: Page;

test.describe("CustomTheme should be applied", () => {
  let common: Common;
  let themeVerifier: ThemeVerifier;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    themeVerifier = new ThemeVerifier(page);

    await common.loginAsGuest();
    await page
      .getByRole("button", {
        name: t["plugin.quickstart"][lang]["footer.hide"],
      })
      .click();
  });

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
    await expect(page.locator("#dynamic-favicon")).toHaveAttribute(
      "href",
      CUSTOM_FAVICON.LIGHT,
    );
  });

  test("Verify that RHDH CompanyLogo can be customized", async () => {
    await themeVerifier.setTheme(
      t["user-settings"][lang]["themeToggle.names.light"],
    );

    await expect(page.getByTestId("home-logo")).toHaveAttribute(
      "src",
      CUSTOM_SIDEBAR_LOGO.LIGHT,
    );

    await themeVerifier.setTheme(
      t["user-settings"][lang]["themeToggle.names.dark"],
    );
    await expect(page.getByTestId("home-logo")).toHaveAttribute(
      "src",
      CUSTOM_SIDEBAR_LOGO.DARK,
    );
  });

  test("Verify logo link", async () => {
    await expect(
      page.getByTestId("global-header-company-logo").locator("a"),
    ).toHaveAttribute("href", "/");
    await page.getByTestId("global-header-company-logo").click();
    await expect(page).toHaveURL("/");
  });

  test("Verify that title for Backstage can be customized", async () => {
    await expect(page).toHaveTitle(/Red Hat Developer Hub/);
  });
});
