import { Page, expect } from "@playwright/test";
import { APIHelper } from "../../utils/api-helper";
import { UI_HELPER_ELEMENTS } from "../page-objects/global-obj";

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
    await expect(async () => {
      // Clear any existing filter first
      await this.page.getByPlaceholder("Filter", { exact: true }).clear();

      // Fill the filter with search text
      await this.page
        .getByPlaceholder("Filter", { exact: true })
        .fill(searchText);

      // Wait for the filter to be applied and verify no "no-import-jobs-found" message appears
      await expect(this.page.getByTestId("no-import-jobs-found")).toBeHidden({
        timeout: 2000,
      });
    }).toPass({
      intervals: [1_000, 2_000, 5_000],
      timeout: 20_000,
    });
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
