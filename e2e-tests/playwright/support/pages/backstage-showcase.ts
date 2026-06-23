import { Page, expect } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { APIHelper } from "../../utils/api-helper";
import { BACKSTAGE_SHOWCASE_COMPONENTS } from "../page-objects/page-obj";

export class BackstageShowcase {
  private readonly page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  static getShowcasePRs(state: "open" | "closed" | "all", paginated = false) {
    return APIHelper.getGitHubPRs("redhat-developer", "rhdh", state, paginated);
  }

  async clickNextPage() {
    await BACKSTAGE_SHOWCASE_COMPONENTS.getNextPageButton(this.page).click();
  }

  async clickPreviousPage() {
    await BACKSTAGE_SHOWCASE_COMPONENTS.getPreviousPageButton(
      this.page,
    ).click();
  }

  async clickLastPage() {
    await BACKSTAGE_SHOWCASE_COMPONENTS.getLastPageButton(this.page).click();
  }

  async verifyPRRowsPerPage(
    rows: number,
    allPRs: { title: string; number: string }[],
  ) {
    await this.selectRowsPerPage(rows);
    await this.uiHelper.verifyText(allPRs[rows - 1].title, false);
    await this.uiHelper.verifyLink(allPRs[rows].number, {
      exact: false,
      notVisible: true,
    });

    const tableRows = BACKSTAGE_SHOWCASE_COMPONENTS.getTableRows(this.page);
    await expect(tableRows).toHaveCount(rows);
  }

  async selectRowsPerPage(rows: number) {
    await this.page.getByRole("combobox").click();
    await this.page.getByRole("option", { name: String(rows) }).click();
  }

  async verifyPRStatisticsRendered() {
    const regex = /Average Size Of PR\d+ lines/u;
    await this.uiHelper.verifyText(regex);
  }

  async verifyAboutCardIsDisplayed() {
    const url =
      "https://github.com/redhat-developer/rhdh/tree/main/catalog-entities/components/";
    const isLinkVisible = await this.page
      .locator(`a[href="${url}"]`)
      .isVisible();
    if (!isLinkVisible) {
      throw new Error("About card is not displayed");
    }
  }

  async verifyPRRows(
    allPRs: { title: string }[],
    startRow: number,
    lastRow: number,
  ) {
    for (let i = startRow; i < lastRow; i++) {
      await this.uiHelper.verifyRowsInTable([allPRs[i].title], false);
    }
  }
}
