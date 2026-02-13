import { expect, Page, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { KubeClient } from "../../../utils/kube-client";

test.describe("Test Kubernetes Actions plugin", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;
  let kubeClient: KubeClient;
  let namespace: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UIhelper(page);
    kubeClient = new KubeClient();

    test.setTimeout(testInfo.timeout + 6500);

    await common.loginAsGuest();
    await uiHelper.goToSelfServicePage();
  });

  test.beforeEach(async ({}, testInfo) => {
    // Add cool-down period before retries (except on first attempt)
    if (testInfo.retry > 0) {
      const coolDownMs = 2000;
      console.log(
        `Attempt ${testInfo.retry + 1} failed, waiting ${coolDownMs}ms before retry...`,
      );
      await page.waitForTimeout(coolDownMs);
    }
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
    // Wait for form validation to complete before proceeding
    await expect(page.getByRole("button", { name: "Review" })).toBeEnabled();
    await uiHelper.clickButton("Review");
    // Wait for review step to be ready
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
    await uiHelper.clickButton("Create");
    // Wait for creation process to show progress indicator
    await expect(page.getByText("second")).toBeVisible();
    // Verify no error occurred during creation
    await expect(page.getByText("Error")).toBeHidden();
    await kubeClient.getNamespaceByName(namespace);
  });

  test.afterEach(async () => {
    await kubeClient.deleteNamespaceAndWait(namespace);
  });
});
