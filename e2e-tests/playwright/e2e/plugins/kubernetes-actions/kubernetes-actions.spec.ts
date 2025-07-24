import { expect, Page, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { KubeClient } from "../../../utils/kube-client";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";

test.describe("Test Kubernetes Actions plugin", () => {
  // TODO: fix https://issues.redhat.com/browse/RHIDP-6492 and remove the skip
  test.skip(() => process.env.JOB_NAME.includes("operator"));

  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;
  let kubeClient: KubeClient;
  let namespace: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UIhelper(page);
    kubeClient = new KubeClient();

    await common.loginAsGuest();
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
  });

  test("Creates kubernetes namespace", async () => {
    namespace = `test-kubernetes-actions-${Date.now()}`;
    await uiHelper.verifyHeading("Self-service");
    await uiHelper.clickBtnInCard("Create a kubernetes namespace", "Choose");
    await uiHelper.waitForTitle("Create a kubernetes namespace", 2);

    await uiHelper.fillTextInputByLabel("Namespace name", namespace);
    await uiHelper.fillTextInputByLabel("Url", process.env.K8S_CLUSTER_URL);
    await uiHelper.fillTextInputByLabel("Token", process.env.K8S_CLUSTER_TOKEN);
    await uiHelper.checkCheckbox("Skip TLS verification");
    await uiHelper.clickButton("Review");

    // Add a small delay to mimic manual behavior
    await page.waitForTimeout(1000);

    await uiHelper.clickButton("Create");

    console.log("Task started, waiting for completion...");

    // Wait for task execution to begin
    await page.waitForTimeout(3000);

    // More specific selectors for error detection
    const errorIndicators = [
      page.locator("text=Error: Failed to create kubernetes namespace"),
      page.locator(
        `${UI_HELPER_ELEMENTS.MuiTypography}:has-text("Error: Failed to create kubernetes namespace")`,
      ),
      page.locator(
        '[role="alert"]:has-text("Error: Failed to create kubernetes namespace")',
      ),
      page.locator("text=Failed to create kubernetes namespace"),
      page.locator(
        "text=Invalid input passed to action kubernetes:create-namespace",
      ),
    ];

    // More flexible success indicators
    const successIndicators = [
      page.locator('[data-test-id="task-status-done"]'),
      page.locator("text=completed successfully"),
      page.locator("text=Task completed"),
      page.locator('[data-testid="success-icon"]'),
      page.locator("text=Finished step Create kubernetes namespace"),
    ];

    // Wait for completion with detailed logging
    await expect(async () => {
      // Check for any error first - use count() to avoid strict mode violations
      for (const errorLocator of errorIndicators) {
        const errorCount = await errorLocator.count();
        if (errorCount > 0) {
          // Get the first visible error element
          const firstError = errorLocator.first();
          if (await firstError.isVisible()) {
            const errorText = await firstError.textContent();
            console.error("Error detected:", errorText);

            // Capture all logs and error details
            const allLogs = await page.locator("pre").allTextContents();
            const pageText = await page.textContent("body");

            console.error("=== ERROR DETAILS ===");
            console.error("Error text:", errorText);
            console.error("=== PAGE CONTENT ===");
            console.error(pageText);
            console.error("=== LOGS ===");
            console.error(allLogs.join("\n"));

            throw new Error(`Scaffolder task failed: ${errorText}`);
          }
        }
      }

      // Check for success indicators - use count() to avoid strict mode violations
      let foundSuccess = false;
      for (const successLocator of successIndicators) {
        const successCount = await successLocator.count();
        if (successCount > 0) {
          // Get the first visible success element
          const firstSuccess = successLocator.first();
          if (await firstSuccess.isVisible()) {
            const indicatorText = await firstSuccess.textContent();
            console.log("Success indicator found:", indicatorText);

            // Log specifically for the namespace creation completion
            if (
              indicatorText?.includes(
                "Finished step Create kubernetes namespace",
              )
            ) {
              console.log("Namespace creation step completed successfully!");
            }

            foundSuccess = true;
            break;
          }
        }
      }

      if (!foundSuccess) {
        throw new Error("No success indicator found yet");
      }
    }).toPass({
      intervals: [3_000, 5_000, 8_000, 12_000, 15_000],
      timeout: 120_000, // Increased timeout to 2 minutes
    });

    console.log("✅ Namespace creation test completed successfully!");
  });

  test.afterEach(async () => {
    await kubeClient.deleteNamespaceAndWait(namespace);
  });
});
