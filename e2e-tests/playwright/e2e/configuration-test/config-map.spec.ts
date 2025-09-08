import { test, expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
test.describe("Change app-config at e2e test runtime", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "configuration",
    });
  });

  // operator nightly does not require this test as RDS tls test also verifies runtime change
  test.skip(() => process.env.JOB_NAME.includes("operator"));

  test("Verify title change after ConfigMap modification", async ({ page }) => {
    test.setTimeout(300000); // Increasing to 5 minutes

    // Start with a common name, but let KubeClient find the actual ConfigMap
    const configMapName = "app-config-rhdh";
    // eslint-disable-next-line playwright/no-conditional-in-test
    const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
    const deploymentName = "rhdh-developer-hub";

    const kubeUtils = new KubeClient();
    const dynamicTitle = generateDynamicTitle();
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
      console.log("Verifying new title in the UI... ");
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
