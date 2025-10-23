import { Page, expect } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import {
  BACKSTAGE_SHOWCASE_COMPONENTS,
  CATALOG_IMPORT_COMPONENTS,
} from "../page-objects/page-obj";
import { APIHelper } from "../../utils/api-helper";
import { GITHUB_API_ENDPOINTS } from "../../utils/api-endpoints";
import {
  getTranslations,
  getCurrentLanguage,
} from "../../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

export class CatalogImport {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  /**
   * Fills the component URL input and clicks the "Analyze" button.
   * Waits until the analyze button is no longer visible (processing done).
   *
   * @param url - The URL of the component to analyze
   */
  private async analyzeAndWait(url: string): Promise<void> {
    await this.page.fill(CATALOG_IMPORT_COMPONENTS.componentURL, url);
    await expect(
      await this.uiHelper.clickButton(
        t["catalog-import"][lang]["stepInitAnalyzeUrl.nextButtonText"],
      ),
    ).not.toBeVisible({
      timeout: 25_000,
    });
  }

  /**
   * Returns true if the component is already registered
   * (i.e., "Refresh" button is visible instead of "Import").
   *
   * @returns boolean indicating if the component is already registered
   */
  async isComponentAlreadyRegistered(): Promise<boolean> {
    return await this.uiHelper.isBtnVisible(
      t["catalog-import"][lang]["stepReviewLocation.refresh"],
    );
  }

  /**
   * Registers an existing component if it has not been registered yet.
   * If already registered, clicks the "Refresh" button instead.
   *
   * @param url - The component URL to register
   * @param clickViewComponent - Whether to click "View Component" after import
   */
  async registerExistingComponent(
    url: string,
    clickViewComponent: boolean = true,
  ) {
    await this.analyzeAndWait(url);
    const isComponentAlreadyRegistered =
      await this.isComponentAlreadyRegistered();
    if (isComponentAlreadyRegistered) {
      await this.uiHelper.clickButton(
        t["catalog-import"][lang]["stepReviewLocation.refresh"],
      );
      expect(
        await this.uiHelper.isBtnVisible(
          t["catalog-import"][lang]["stepFinishImportLocation.backButtonText"],
        ),
      ).toBeTruthy();
    } else {
      await this.uiHelper.clickButton(
        t["catalog-import"][lang]["stepReviewLocation.import"],
      );
      if (clickViewComponent) {
        await this.uiHelper.clickButton(
          t["catalog-import"][lang][
            "stepFinishImportLocation.locations.viewButtonText"
          ],
        );
      }
    }
    return isComponentAlreadyRegistered;
  }

  async analyzeComponent(url: string) {
    await this.page.fill(CATALOG_IMPORT_COMPONENTS.componentURL, url);
    await this.uiHelper.clickButton(
      t["catalog-import"][lang]["stepInitAnalyzeUrl.nextButtonText"],
    );
  }

  async inspectEntityAndVerifyYaml(text: string) {
    await this.page.getByTitle("More").click();
    await this.page.getByRole("menuitem").getByText("Inspect entity").click();
    await this.uiHelper.clickTab("Raw YAML");
    await expect(this.page.getByTestId("code-snippet")).toContainText(text);
    await this.uiHelper.clickButton("Close");
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
      GITHUB_API_ENDPOINTS.issues("open"),
    );
    return rep.filter(
      (issue: { pull_request: boolean }) => !issue.pull_request,
    );
  }

  static async getShowcasePRs(
    state: "open" | "closed" | "all",
    paginated = false,
  ) {
    return await APIHelper.getGitHubPRs(
      "redhat-developer",
      "rhdh",
      state,
      paginated,
    );
  }

  async clickNextPage() {
    await this.page.click(BACKSTAGE_SHOWCASE_COMPONENTS.tableNextPage);
  }

  async clickPreviousPage() {
    await this.page.click(BACKSTAGE_SHOWCASE_COMPONENTS.tablePreviousPage);
  }

  async clickLastPage() {
    await this.page.click(BACKSTAGE_SHOWCASE_COMPONENTS.tableLastPage);
  }

  async verifyPRRowsPerPage(rows, allPRs) {
    await this.selectRowsPerPage(rows);
    await this.uiHelper.verifyText(allPRs[rows - 1].title, false);
    await this.uiHelper.verifyLink(allPRs[rows].number, {
      exact: false,
      notVisible: true,
    });

    const tableRows = this.page.locator(
      BACKSTAGE_SHOWCASE_COMPONENTS.tableRows,
    );
    await expect(tableRows).toHaveCount(rows);
  }

  async selectRowsPerPage(rows: number) {
    await this.page.click(BACKSTAGE_SHOWCASE_COMPONENTS.tablePageSelectBox);
    await this.page.click(`ul[role="listbox"] li[data-value="${rows}"]`);
  }

  async getWorkflowRuns() {
    const response = await APIHelper.githubRequest(
      "GET",
      GITHUB_API_ENDPOINTS.workflowRuns,
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
