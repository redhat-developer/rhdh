import { Page, expect } from "@playwright/test";
import { APIHelper } from "../../utils/api-helper";
import { UI_HELPER_ELEMENTS } from "../pageObjects/global-obj";

export class BulkImport {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async searchInOrg(searchText: string) {
    await this.page
      .getByTestId("search-in-organization")
      .getByPlaceholder("Search", { exact: true })
      .fill(searchText);
  }

  async filterAddedRepo(searchText: string) {
    await this.page
      .getByPlaceholder("Search", { exact: true })
      .fill(searchText);
  }

  async newGitHubRepo(owner: string, repoName: string) {
    await expect(async () => {
      await APIHelper.createGitHubRepo(owner, repoName);
      await APIHelper.initCommit(owner, repoName);
    }).toPass({
      intervals: [1_000, 2_000],
      timeout: 15_000,
    });
  }

  async selectRepoInTable(repoName: string) {
    await this.page
      .locator(UI_HELPER_ELEMENTS.rowByText(repoName))
      .getByRole("checkbox")
      .check();
  }

  async fillTextInputByNameAtt(label: string, text: string) {
    await this.page
      .locator(`input[name*="${label}"], textarea[name*="${label}"]`)
      .fill(text);
  }
}
