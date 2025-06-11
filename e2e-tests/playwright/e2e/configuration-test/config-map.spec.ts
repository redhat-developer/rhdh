import { test, expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";

test.describe.skip("Change app-config at e2e test runtime", () => {
  test("Verify title change after ConfigMap modification", async ({ page }) => {
    test.setTimeout(300000); // Increasing to 5 minutes

    const configMapName = "rhdh-backstage-app-config";
    const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
    const deploymentName = "rhdh-backstage";

    const kubeUtils = new KubeClient();
    const dynamicTitle = generateDynamicTitle();
    const uiHelper = new UIhelper(page);
    try {
      console.log(`Updating ConfigMap '${configMapName}' with new title.`);
      await kubeUtils.updateConfigMapTitle(
        configMapName,
        namespace,
        dynamicTitle,
      );

      console.log(
        `Restarting deployment '${deploymentName}' to apply ConfigMap changes.`,
      );
      await kubeUtils.restartDeployment(deploymentName, namespace);

      const common = new Common(page);
      await page.context().clearCookies();
      await page.context().clearPermissions();
      await page.reload({ waitUntil: "domcontentloaded" });
      await common.loginAsGuest();
      await new UIhelper(page).openSidebar("Home");
      await uiHelper.verifyHeading("Welcome back!");
      await uiHelper.verifyText("Quick Access");
      await expect(page.locator("#search-bar-text-field")).toBeVisible();
      console.log("Verifying new title in the UI...");
      expect(await page.title()).toContain(dynamicTitle);
      console.log("Title successfully verified in the UI.");
    } catch (error) {
      console.log(
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
