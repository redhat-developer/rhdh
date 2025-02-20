import { Page, expect, TestInfo } from "@playwright/test";
import { UIhelper } from "../ui-helper";
import { UI_HELPER_ELEMENTS } from "../../support/pageObjects/global-obj";

export class ThemeVerifier {
  private readonly page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async setTheme(theme: "Light" | "Dark" | "Light Dynamic" | "Dark Dynamic") {
    await this.uiHelper.goToSettingsPage();
    await this.uiHelper.clickBtnByTitleIfNotPressed(`Select theme ${theme}`);
  }

  async verifyHeaderGradient(expectedGradient: string) {
    const header = await this.page.locator("main header");
    await expect(header).toHaveCSS("background-image", expectedGradient);
  }

  async verifyBorderLeftColor(expectedColor: string) {
    await this.uiHelper.openSidebar("Home");
    const locator = await this.page.locator("a").filter({ hasText: "Home" });
    await expect(locator).toHaveCSS(
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
    await this.uiHelper.goToSettingsPage();
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
