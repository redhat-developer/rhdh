import { test, Page, TestInfo, expect } from "@playwright/test";
import { Common, setupBrowser } from "../utils/common";
import { ThemeVerifier } from "../utils/custom-theme/theme-verifier";
import {
  CUSTOM_TAB_ICON,
  CUSTOM_BRAND_ICON,
} from "../support/testData/custom-theme";
import { ThemeConstants } from "../data/theme-constants";
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

  test("Verify that tab icon for Backstage can be customized", async () => {
    expect(await page.locator("#dynamic-favicon").getAttribute("href")).toEqual(
      CUSTOM_TAB_ICON,
    );
  });

  test("Verify that brand icon for Backstage can be customized", async () => {
    expect(await page.getByTestId("home-logo").getAttribute("src")).toEqual(
      CUSTOM_BRAND_ICON,
    );
  });

  test("Verify that title for Backstage can be customized", async () => {
    await expect(page).toHaveTitle(/Red Hat Developer Hub/);
  });
});
