import { Page, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UiHelper } from "../../../utils/ui-helper";
import { KubeClient } from "../../../utils/kube-client";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";

test.describe("Test Kubernetes Actions plugin", () => {
  let common: Common;
  let uiHelper: UiHelper;
  let page: Page;
  let kubeClient: KubeClient;
  let namespace: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UiHelper(page);
    kubeClient = new KubeClient();

    await common.loginAsGuest();
    await uiHelper.openSidebar("Create...");
  });

  test("Creates kubernetes namespace", async () => {
    namespace = `test-kubernetes-actions-${Date.now()}`;
    await uiHelper.verifyHeading("Software Templates");
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
    await kubeClient.getNamespaceByName(namespace);
  });

  test.afterEach(async () => {
    await kubeClient.deleteNamespaceAndWait(namespace);
  });
});
