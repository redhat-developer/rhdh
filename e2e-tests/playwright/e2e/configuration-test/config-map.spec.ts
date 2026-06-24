import { test, expect } from "@support/coverage/test";

import { RhdhHomePage } from "../../support/pages/rhdh-home-page";
import { Common } from "../../utils/common";
import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";

test.describe("Change app-config at e2e test runtime", () => {
  test.beforeAll(() => {
    test.info().annotations.push(
      {
        type: "component",
        description: "configuration",
      },
      {
        type: "namespace",
        description: process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime",
      },
    );
  });

  test("Verify title change after ConfigMap modification", async ({ page }) => {
    const configMapName = "app-config-rhdh";

    const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
    const deploymentName = getRhdhDeploymentName();

    const kubeUtils = new KubeClient();
    const dynamicTitle = generateDynamicTitle();
    try {
      console.log(`Updating ConfigMap '${configMapName}' with new title.`);
      await kubeUtils.updateConfigMapTitle(configMapName, namespace, dynamicTitle);

      console.log(`Restarting deployment '${deploymentName}' to apply ConfigMap changes.`);
      await kubeUtils.restartDeployment(deploymentName, namespace);

      const common = new Common(page);
      await page.context().clearCookies();
      await page.context().clearPermissions();
      await page.reload({ waitUntil: "domcontentloaded" });
      await common.loginAsGuest();
      await new RhdhHomePage(page).openHomeSidebar();
      console.log("Verifying new title in the UI... ");
      expect(await page.title()).toContain(dynamicTitle);
      console.log("Title successfully verified in the UI.");
    } catch (error) {
      console.log(`Test failed during ConfigMap update or deployment restart:`, error);
      throw error;
    }
  });
});

function generateDynamicTitle() {
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  return `New Title - ${timestamp}`;
}
