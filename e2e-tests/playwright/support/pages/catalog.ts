import { Locator, Page } from "@playwright/test";
import playwrightConfig from "../../../playwright.config";
import { UIhelper } from "../../utils/ui-helper";

//${BASE_URL}/catalog page
export class Catalog {
  private page: Page;
  private uiHelper: UIhelper;
  private searchField: Locator;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
    this.searchField = page.locator("#input-with-icon-adornment");
  }

  async go() {
    await this.uiHelper.openSidebar("Catalog");
  }

  async goToBackstageJanusProjectCITab() {
    await this.goToBackstageShowcaseProject();
    await this.uiHelper.clickTab("CI");
    await this.page.waitForSelector('h2:text("Pipeline Runs")');
    await this.uiHelper.verifyHeading("Pipeline Runs");
  }

  async goToBackstageShowcaseProject() {
    await this.uiHelper.openSidebar("Catalog");
    await this.uiHelper.clickByDataTestId("user-picker-all");
    await this.page.getByRole("link", { name: "Backstage Showcase" }).click();
  }

  async search(s: string) {
    await this.searchField.clear();
    const searchResponse = this.page.waitForResponse(
      new RegExp(
        `${playwrightConfig.use.baseURL}/api/catalog/entities/by-query/*`,
      ),
    );
    await this.searchField.fill(s);
    await searchResponse;
  }

  async tableRow(content: string) {
    return this.page.locator(`tr >> a >> text="${content}"`);
  }
}
