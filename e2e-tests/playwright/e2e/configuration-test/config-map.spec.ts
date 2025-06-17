import { test, expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { LOGGER } from "../../utils/logger";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe("Change app-config at e2e test runtime", () => {
  test("Verify title change after ConfigMap modification", async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    const configMapName = "app-config";
    const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
    const deploymentName = "rhdh-backstage";

    const kubeUtils = new KubeClient();
    const dynamicTitle = generateDynamicTitle();
    try {
      console.log(
        `Updating ConfigMap '${configMapName}' with new title: ${dynamicTitle}`,
      );
      await kubeUtils.updateConfigMapTitle(
        configMapName,
        namespace,
        dynamicTitle,
      );

      console.log(
        `Restarting deployment '${deploymentName}' to apply ConfigMap changes.`,
      );
      await kubeUtils.restartDeployment(deploymentName, namespace);

      console.log("Deployment restarted successfully. Loading page...");
      const common = new Common(page);
      await page.context().clearCookies();
      await page.context().clearPermissions();
      await page.reload({ waitUntil: "domcontentloaded" });
      await common.loginAsGuest();
      await new UIhelper(page).openSidebar("Home");
      console.log("Verifying new title in the UI...");
      expect(await page.title()).toContain(dynamicTitle);
      console.log("Title successfully verified in the UI.");
    } catch (error) {
      LOGGER.error(
        `Test failed during ConfigMap update or deployment restart:`,
        error,
      );
      throw error;
    }
  });
});

function generateDynamicTitle() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  return `New Title - ${timestamp}`;
}
