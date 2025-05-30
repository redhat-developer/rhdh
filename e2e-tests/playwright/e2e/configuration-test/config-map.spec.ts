import { test, expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { LOGGER } from "../../utils/logger";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe("Change app-config at e2e test runtime", () => {
  test("Verify title change after ConfigMap modification", async ({ page }) => {
    test.setTimeout(900000); // Increased to 15 minutes

    const configMapName = "rhdh-backstage-app-config";
    const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
    const deploymentName = "rhdh-backstage";

    const kubeUtils = new KubeClient();
    const dynamicTitle = generateDynamicTitle();
    try {
      LOGGER.info(
        `Updating ConfigMap '${configMapName}' with new title: ${dynamicTitle}`,
      );
      await kubeUtils.updateConfigMapTitle(
        configMapName,
        namespace,
        dynamicTitle,
      );

      LOGGER.info(
        `Restarting deployment '${deploymentName}' to apply ConfigMap changes.`,
      );
      await kubeUtils.restartDeployment(deploymentName, namespace);

      LOGGER.info("Deployment restarted successfully. Loading page...");
      const common = new Common(page);
      await page.context().clearCookies();
      await page.context().clearPermissions();
      await page.reload({ waitUntil: "domcontentloaded" });
      await common.loginAsGuest();
      await new UIhelper(page).openSidebar("Home");
      await expect(page.locator("#search-bar-text-field")).toBeVisible();
      LOGGER.info("Verifying new title in the UI...");
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
