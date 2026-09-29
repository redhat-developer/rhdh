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
    // Scope the pods chip to the deployment's own accordion summary: the
    // page-wide set of "Status ok" chips varies with cluster contents and
    // the user's RBAC visibility, so a positional nth() breaks whenever a
    // resource appears or disappears (RHDHBUGS-3775).
    const podCountChip = this.page
      .locator(KUBERNETES_COMPONENTS.statusOk)
      .filter({ hasText: /\d+ pods?/ });
    const deploymentSummary = this.page
      .getByRole("button", {
        name: `${text} Deployment namespace: ${process.env.NAME_SPACE_RBAC}`,
        exact: true,
      })
      .filter({ has: podCountChip })
      .first();
    const pods = deploymentSummary
      .locator(KUBERNETES_COMPONENTS.statusOk)
      .filter({ hasText: /\d+ pods?/ })
      .first();
    await pods.scrollIntoViewIfNeeded();
    await expect(pods).toHaveText(/1 pods?/);
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
        this.page.getByRole("textbox", { name: /search/i }),
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
