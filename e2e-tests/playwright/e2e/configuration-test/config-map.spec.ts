import { test, expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { LOGGER } from "../../utils/logger";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe("Change app-config at e2e test runtime", () => {
  test("Verify title change after ConfigMap modification", async ({ page }) => {
    test.setTimeout(300000); // Increasing to 5 minutes

    // Start with a common name, but let KubeClient find the actual ConfigMap
    const configMapName = "app-config-rhdh";
    const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
    const deploymentName = "rhdh-backstage";

    const kubeUtils = new KubeClient();
    const dynamicTitle = generateDynamicTitle();
    try {
      LOGGER.info(`Looking for app-config ConfigMap in namespace '${namespace}'`);
      LOGGER.info(`Updating ConfigMap with new title: '${dynamicTitle}'`);
      await kubeUtils.updateConfigMapTitle(
        configMapName,
        namespace,
        dynamicTitle,
      );

      LOGGER.info(
        `Restarting deployment '${deploymentName}' to apply ConfigMap changes.`,
      );
      await kubeUtils.restartDeployment(deploymentName, namespace);

      const common = new Common(page);
      await page.context().clearCookies();
      await page.context().clearPermissions();
      await page.reload({ waitUntil: "domcontentloaded" });
      await common.loginAsGuest();
      await new UIhelper(page).openSidebar("Home");
      LOGGER.info("Verifying new title in the UI... ");
      expect(await page.title()).toContain(dynamicTitle);
      LOGGER.info("Title successfully verified in the UI.");
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
