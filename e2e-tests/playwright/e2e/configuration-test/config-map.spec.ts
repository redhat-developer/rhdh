import { test, expect } from "@support/coverage/test";

import { Common } from "../../utils/common";
import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import { UIhelper } from "../../utils/ui-helper";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";

test.describe("Change app-config at e2e test runtime", () => {
  test.beforeAll(async () => {
    test.setTimeout(900000); // 15 minutes — includes deployment if needed
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

    // Deploy RHDH if not already running. This test runs first in the
    // showcase-runtime project, so it handles the full deployment lifecycle.
    // Subsequent specs reuse the existing deployment (workers: 1).
    await ensureRuntimeDeployed();
  });

  test("Verify title change after ConfigMap modification", async ({ page }) => {
    test.setTimeout(300000);

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
      await new UIhelper(page).openSidebar("Home");
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
