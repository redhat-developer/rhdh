import { test, expect } from "@support/coverage/test";

import { signInAsGuest } from "../../support/auth/guest-auth";
import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";

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
    const runtimeHarness = new RuntimeHarness(namespace);
    const dynamicTitle = generateDynamicTitle();
    try {
      console.log(`Updating ConfigMap '${configMapName}' with new title.`);
      await runtimeHarness.updateConfigMapTitle(configMapName, dynamicTitle);
      console.log("Restarting deployment to apply ConfigMap changes.");
      await runtimeHarness.restartDeploymentWithRetry();

      await page.context().clearCookies();
      await page.context().clearPermissions();
      await page.reload({ waitUntil: "domcontentloaded" });
      await signInAsGuest(page);
      await new HomePage(page).openHomeSidebar();
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
