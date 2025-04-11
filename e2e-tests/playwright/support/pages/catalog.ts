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

  async goToByName(name: string) {
    await this.uiHelper.openCatalogSidebar("Component");
    await this.uiHelper.clickLink(name);
  }

  async goToBackstageJanusProjectCITab() {
    await this.goToBackstageJanusProject();
    await this.uiHelper.clickTab("CI");
    await this.page.waitForSelector('h2:text("Pipeline Runs")');
    await this.uiHelper.verifyHeading("Pipeline Runs");
  }

  async goToBackstageJanusProject() {
    await this.goToByName("backstage-janus");
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
