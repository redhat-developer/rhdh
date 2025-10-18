import { Page, expect, TestInfo } from "@playwright/test";
import { UIhelper } from "../ui-helper";
import { UI_HELPER_ELEMENTS } from "../../support/page-objects/global-obj";
import {
  getTranslations,
  getCurrentLanguage,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();
export class ThemeVerifier {
  private readonly page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async setTheme(theme: "Light" | "Dark" | "Light Dynamic" | "Dark Dynamic") {
    await this.uiHelper.goToPageUrl(
      "/settings",
      t["user-settings"][lang]["settingsLayout.title"],
    );
    await this.uiHelper.clickBtnByTitleIfNotPressed(`Select theme ${theme}`);
    const themeButton = this.page.getByRole("button", {
      name: theme,
      exact: true,
    });

    // TODO: https://issues.redhat.com/browse/RHDHBUGS-2076 navigating back to settings page is needed until the issue is resolved
    await this.uiHelper.goToPageUrl(
      "/settings",
      t["user-settings"][lang]["settingsLayout.title"],
    );

    await expect(themeButton).toHaveAttribute("aria-pressed", "true");
  }

  async verifyHeaderGradient(expectedGradient: string) {
    const header = this.page.locator("main header").first();
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS("background-image", expectedGradient);
  }

  async verifyBorderLeftColor(expectedColor: string) {
    await this.uiHelper.openSidebar("Home");
    const homeLinkLocator = this.page.locator("a").filter({ hasText: "Home" });
    await expect(homeLinkLocator).toHaveCSS(
      "border-left",
      `3px solid ${expectedColor}`,
    );
  }

  async verifyPrimaryColors(colorPrimary: string) {
    await this.uiHelper.checkCssColor(
      this.page,
      UI_HELPER_ELEMENTS.MuiTypographyColorPrimary,
      colorPrimary,
    );
    await this.uiHelper.checkCssColor(
      this.page,
      UI_HELPER_ELEMENTS.MuiSwitchColorPrimary,
      colorPrimary,
    );
    await this.uiHelper.openSidebar("Catalog");
    await this.uiHelper.checkCssColor(
      this.page,
      UI_HELPER_ELEMENTS.MuiButtonTextPrimary,
      colorPrimary,
    );
  }

  async takeScreenshotAndAttach(
    screenshotPath: string,
    testInfo: TestInfo,
    description: string,
  ) {
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(description, { path: screenshotPath });
  }
}
