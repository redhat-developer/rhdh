import { expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { baseTest } from "../../support/fixtures/base";

baseTest.describe("Change app-config at e2e test runtime", () => {
  // operator nightly does not require this test as RDS tls test also verifies runtime change
  baseTest.skip(() => process.env.JOB_NAME.includes("operator"));

  baseTest(
    "Verify title change after ConfigMap modification",
    async ({ page, common, uiHelper }) => {
      baseTest.setTimeout(300000); // Increasing to 5 minutes

      // Start with a common name, but let KubeClient find the actual ConfigMap
      const configMapName = "app-config-rhdh";
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

        await page.context().clearCookies();
        await page.context().clearPermissions();
        await page.reload({ waitUntil: "domcontentloaded" });
        await common.loginAsGuest();
        await uiHelper.openSidebar("Home");
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
    },
  );
});

function generateDynamicTitle() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  return `New Title - ${timestamp}`;
}
