import { Page, expect } from "@playwright/test";

import { APIHelper } from "../../utils/api-helper";
import * as verification from "../../utils/ui-helper/verification";
import { RHDH_INSTANCE_TABLE } from "../selectors/rhdh-instance-table";

/** Page object for RHDH instance catalog views (PR tables, entity cards). */
export class RhdhInstance {
  constructor(private readonly page: Page) {}

  static getRhdhPullRequests(state: "open" | "closed" | "all", paginated = false) {
    return APIHelper.getGitHubPRs("redhat-developer", "rhdh", state, paginated);
  }

  async clickNextPage() {
    await RHDH_INSTANCE_TABLE.getNextPageButton(this.page).click();
  }

  async clickPreviousPage() {
    await RHDH_INSTANCE_TABLE.getPreviousPageButton(this.page).click();
  }

  async clickLastPage() {
    await RHDH_INSTANCE_TABLE.getLastPageButton(this.page).click();
  }

  async verifyPRRowsPerPage(rows: number, allPRs: { title: string; number: string }[]) {
    await this.selectRowsPerPage(rows);
    await verification.verifyText(this.page, allPRs[rows - 1].title, false);
    await verification.verifyLink(this.page, allPRs[rows].number, { exact: false, notVisible: true });

    const tableRows = RHDH_INSTANCE_TABLE.getTableRows(this.page);
    await expect(tableRows).toHaveCount(rows);
  }

  async selectRowsPerPage(rows: number) {
    await this.page.getByRole("combobox").click();
    await this.page.getByRole("option", { name: String(rows) }).click();
  }

  async verifyPRStatisticsRendered() {
    const regex = /Average Size Of PR\d+ lines/u;
    await verification.verifyText(this.page, regex);
  }

  async verifyAboutCardIsDisplayed() {
    const url = "https://github.com/redhat-developer/rhdh/tree/main/catalog-entities/components/";
    await expect(this.page.locator(`a[href="${url}"]`)).toBeVisible();
  }

  async verifyPRRows(allPRs: { title: string }[], startRow: number, lastRow: number) {
    for (let i = startRow; i < lastRow; i++) {
      await verification.verifyRowsInTable(this.page, [allPRs[i].title], false);
    }
  }

  async waitForEntityPath(path: string): Promise<void> {
    await this.page.waitForURL(`**${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    expect(this.page.url()).toContain(path);
  }

  /** Workaround for RHDHBUGS-2091: smaller page size avoids missing PR stats. */
  async setPullRequestPageSize(size: number): Promise<void> {
    await this.page.getByRole("button", { name: "20" }).click();
    await this.page.getByRole("option", { name: String(size), exact: true }).click();
  }

  async clickPullRequestFilter(name: string): Promise<void> {
    const button = this.page.getByRole("button", { name });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.click();
  }
}
