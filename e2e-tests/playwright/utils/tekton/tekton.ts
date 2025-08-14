import { expect, Page } from "@playwright/test";
import { UIhelper } from "../ui-helper";

export class Tekton {
  page: Page;
  uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  getAllGridColumnsTextForPipelineRunsTable() {
    return ["NAME", "STATUS", "TASK STATUS", "STARTED", "DURATION"];
  }

  async clickOnExpandRowFromPipelineRunsTable() {
    await this.page
      .locator(
        'table[aria-labelledby="Pipeline Runs"] button[aria-label="expand row"]',
      )
      .first()
      .click();
  }

  async openModalEchoHelloWorld() {
    const loc = 'g[data-test="task echo-hello-world"]';
    await this.page.waitForSelector(loc);
    await this.page.locator(loc).click();
  }

  async ensurePipelineRunsTableIsNotEmpty() {
    const rowCount = await this.page
      .locator('table[aria-labelledby="Pipeline Runs"] tbody tr')
      .count();
    expect(rowCount).toBeGreaterThan(0);
  }

  async search(value: string) {
    const searchInput = this.page.locator('input[placeholder="Search"]');
    await searchInput.waitFor({ state: "visible" });
    await searchInput.fill(value);
  }

  async isModalOpened() {
    await expect(this.page.locator("#pipelinerun-logs")).toBeVisible();
  }

  async checkPipelineStages(texts: string[]) {
    for (const text of texts) {
      await this.uiHelper.verifyHeading(text);
    }
  }
}
