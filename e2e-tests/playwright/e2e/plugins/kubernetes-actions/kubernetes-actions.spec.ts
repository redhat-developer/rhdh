import { expect } from "@playwright/test";
import { KubeClient } from "../../../utils/kube-client";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";
import { guestTest } from "../../../support/fixtures/guest-login";

guestTest.describe("Test Kubernetes Actions plugin", () => {
  let kubeClient: KubeClient;
  let namespace: string;

  guestTest.beforeAll(async ({ uiHelper }) => {
    kubeClient = new KubeClient();
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
  });

  guestTest("Creates kubernetes namespace", async ({ uiHelper, page }) => {
    namespace = `test-kubernetes-actions-${Date.now()}`;
    await uiHelper.verifyHeading("Self-service");
    await uiHelper.clickBtnInCard("Create a kubernetes namespace", "Choose");
    await uiHelper.waitForTitle("Create a kubernetes namespace", 2);

    await uiHelper.fillTextInputByLabel("Namespace name", namespace);
    await uiHelper.fillTextInputByLabel("Url", process.env.K8S_CLUSTER_URL);
    await uiHelper.fillTextInputByLabel("Token", process.env.K8S_CLUSTER_TOKEN);
    await uiHelper.checkCheckbox("Skip TLS verification");
    await uiHelper.clickButton("Review");
    await uiHelper.clickButton("Create");
    await page.waitForSelector(
      `${UI_HELPER_ELEMENTS.MuiTypography}:has-text("second")`,
    );
    await expect(
      page.locator(`${UI_HELPER_ELEMENTS.MuiTypography}:has-text("Error")`),
    ).not.toBeVisible();
    await kubeClient.getNamespaceByName(namespace);
  });

  guestTest.afterEach(async () => {
    await kubeClient.deleteNamespaceAndWait(namespace);
  });
});
