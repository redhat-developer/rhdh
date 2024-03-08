import { Page, expect } from '@playwright/test';
import { UIhelper } from '../../utils/UIhelper';
import { BackstageShowcasePO, CatalogImportPO } from '../pageObjects/page-obj';
import { APIHelper } from '../../utils/APIHelper';
import { githubAPIEndpoints } from '../../utils/APIEndpoints';

export class CatalogImport {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }
  async registerExistingComponent(url: string) {
    await this.page.fill(CatalogImportPO.componentURL, url);
    await this.uiHelper.clickButton('Analyze');

    // Wait for the visibility of either 'Refresh' or 'Import' button
    try {
      await this.page.waitForSelector(this.uiHelper.getSelector('Refresh'), { state: 'visible', timeout: 10000 })
        .then(async () => {
          await this.uiHelper.clickButton('Refresh');
          expect(await this.uiHelper.isBtnVisible('Register another')).toBeTruthy();
        })
        .catch(async () => {
          // If the 'Refresh' button does not appear, wait for the 'Import' button
          await this.page.waitForSelector(this.uiHelper.getSelector('Import'), { state: 'visible', timeout: 10000 });
          await this.uiHelper.clickButton('Import');
          await this.uiHelper.clickButton('View Component');
        });
    } catch (error) {
      // Handle the general error if neither button can be located
      console.error('Error while registering component:', error);
    }
  }
}

export class BackstageShowcase {
  private readonly page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async getGithubOpenIssues() {
    const rep = await APIHelper.getGithubPaginatedRequest(
      githubAPIEndpoints.issues('open'),
    );
    return rep.filter((issue: any) => !issue.pull_request);
  }

  static async getGithubPRs(
    state: 'open' | 'closed' | 'all',
    paginated = false,
  ) {
    const url = githubAPIEndpoints.pull(state);
    if (paginated) {
      return APIHelper.getGithubPaginatedRequest(url);
    }
    const response = await APIHelper.githubRequest('GET', url);
    return response.json();
  }

  async clickNextPage() {
    await this.page.click(BackstageShowcasePO.tableNextPage);
  }

  async clickPreviousPage() {
    await this.page.click(BackstageShowcasePO.tablePreviousPage);
  }

  async clickLastPage() {
    await this.page.click(BackstageShowcasePO.tableLastPage);
  }

  async clickFirstPage() {
    await this.page.click(BackstageShowcasePO.tableFirstPage);
  }
  async verifyPRRowsPerPage(rows, allPRs) {
    await this.selectRowsPerPage(rows);
    await this.uiHelper.verifyText(allPRs[rows - 1].title);
    await this.uiHelper.verifyLink(allPRs[rows].number, { notVisible: true });

    const tableRows = this.page.locator(BackstageShowcasePO.tableRows);
    await expect(tableRows).toHaveCount(rows);
  }

  async selectRowsPerPage(rows: number) {
    await this.page.click(BackstageShowcasePO.tablePageSelectBox);
    await this.page.click(`ul[role="listbox"] li[data-value="${rows}"]`);
  }

  async getWorkflowRuns() {
    const response = await APIHelper.githubRequest(
      'GET',
      githubAPIEndpoints.workflowRuns,
    );
    const responseBody = await response.json();
    return responseBody.workflow_runs;
  }

  async verifyPRStatisticsRendered() {
    const regex = /Average Size Of PR\d+ lines/;
    await this.uiHelper.verifyText(regex);
  }

  async verifyAboutCardIsDisplayed() {
    const url =
      'https://github.com/janus-idp/backstage-showcase/tree/main/catalog-entities/components/';
    const isLinkVisible = await this.page
      .locator(`a[href="${url}"]`)
      .isVisible();
    if (!isLinkVisible) {
      throw new Error('About card is not displayed');
    }
  }

  async verifyPRRows(allPRs: any[], startRow: number, lastRow: number) {
    for (let i = startRow; i < lastRow; i++) {
      await this.uiHelper.verifyRowsInTable([allPRs[i].title], false);
    }
  }
}
