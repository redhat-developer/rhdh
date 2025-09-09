import { Page, expect } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { KUBERNETES_COMPONENTS } from "../page-objects/page-obj";

export class KubernetesPage {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async verifyDeployment(text: string) {
    const deployment = this.page.locator(
      `text=${text}Deploymentnamespace: ${process.env.NAME_SPACE_RBAC}`,
    );
    await deployment.scrollIntoViewIfNeeded();
    await expect(deployment).toBeVisible();
  }

  async verifyPodLogs(text: string, heading: string, allowed?: boolean) {
    await this.verifyDeployment(text);
    const pods = this.page.locator(KUBERNETES_COMPONENTS.statusOk).nth(4);
    await pods.scrollIntoViewIfNeeded();
    await expect(pods).toHaveText("1 pods");
    await pods.click();

    const pod = this.page.locator("h6").filter({ hasText: text }).first();
    await pod.scrollIntoViewIfNeeded();
    await expect(pod).toBeVisible();
    await pod.click();

    const podLogs = this.page.locator(KUBERNETES_COMPONENTS.podLogs).first();
    await podLogs.scrollIntoViewIfNeeded();
    await podLogs.click();

    await this.uiHelper.verifyHeading(heading);

    if (allowed) {
      await expect(
        this.page.locator(`input[placeholder="Search"]`),
      ).toBeVisible();
    } else {
      await this.page
        .locator(KUBERNETES_COMPONENTS.MuiSnackbarContent)
        .waitFor({ state: "visible" });
      expect(
        await this.page
          .locator(KUBERNETES_COMPONENTS.MuiSnackbarContent)
          .textContent(),
      ).toContain("NotAllowedError");
    }
  }
}
