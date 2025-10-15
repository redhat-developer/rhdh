import { expect, Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { downloadAndReadFile } from "../../utils/helper";

export class Topology {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async hoverOnPodStatusIndicator() {
    const locator = this.page
      .locator('[data-test-id="topology-test"]')
      .getByText("1Pod")
      .first();
    await locator.hover();
    await this.page.waitForTimeout(1000);
  }

  async verifyMissingTopologyPermission() {
    await this.uiHelper.verifyHeading("Missing Permission");
    await this.uiHelper.verifyText("kubernetes.clusters.read");
    await this.uiHelper.verifyText("kubernetes.resources.read");
    await expect(this.page.getByLabel("Pod")).toBeHidden();
  }

  async verifyDeployment(name: string) {
    await this.uiHelper.verifyText(name);
    const deployment = this.page
      .locator(`[data-test-id="${name}"] image`)
      .first();
    await expect(deployment).toBeVisible();
    await deployment.click();
    await this.page.getByLabel("Pod").click();
    await this.page.getByLabel("Pod").getByText("1", { exact: true }).click();
  }

  async verifyPodLogs(allowed: boolean) {
    await this.uiHelper.clickTab("Resources");
    await this.page
      .locator('button:has(span:text("View Logs"))')
      .first()
      .click();

    if (allowed) {
      const downloadLogsButton = this.page.getByRole("button", {
        name: "download logs",
      });
      const fileContent = await downloadAndReadFile(
        this.page,
        downloadLogsButton,
      );
      expect(fileContent).not.toBeUndefined();
      expect(fileContent).not.toBe("");
    } else {
      await this.uiHelper.verifyHeading("Missing Permission");
      await this.uiHelper.verifyText("kubernetes.proxy");
    }
  }
}
