import { test, expect } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Catalog } from "../../../support/pages/catalog";
import { KUBERNETES_COMPONENTS } from "../../../support/page-objects/page-obj";
import { KubernetesPage } from "../../../support/pages/kubernetes";

test.describe("Test Kubernetes Plugin", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalog: Catalog;
  let kubernetes: KubernetesPage;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.retry > 0) {
      // progressively increase test timeout for retries
      test.setTimeout(testInfo.timeout + testInfo.timeout * 0.25);
    }
    common = new Common(page);
    uiHelper = new UIhelper(page);
    catalog = new Catalog(page);
    kubernetes = new KubernetesPage(page);
  });

  test.describe("Verify that a user with permissions is able to access the Kubernetes plugin", () => {
    test.beforeEach(async ({ page }) => {
      await common.loginAsKeycloakUser();

      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Kubernetes");
      await uiHelper.verifyText("backstage-janus");

      await page
        .locator(KUBERNETES_COMPONENTS.MuiAccordion)
        .getByRole("button", { name: "my-cluster Cluster" })
        .click();
    });

    test("Verify pods visibility in the Kubernetes tab", async () => {
      await kubernetes.verifyDeployment("topology-test");
    });

    test("Verify pod logs visibility in the Kubernetes tab", async () => {
      await kubernetes.verifyPodLogs("topology-test", "topology-test", true);
    });
  });

  // User is able to read from the catalog
  // User is unable to read kubernetes resources / clusters and use kubernetes proxy (needed for pod logs)
  test.describe("Verify that a user without permissions is not able to access parts of the Kubernetes plugin", () => {
    test("Verify pods are not visible in the Kubernetes tab", async ({
      page,
    }) => {
      await common.loginAsKeycloakUser(
        process.env.QE_USER6_ID,
        process.env.QE_USER6_PASS,
      );

      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Kubernetes");
      await uiHelper.verifyText("backstage-janus");

      await expect(
        page.locator("h6").filter({ hasText: "Warning: Permission required" }),
      ).toBeVisible();
    });

    // User is able to read from the catalog and read kubernetes resources and kubernetes clusters
    // User is unable to use kubernetes proxy (needed for pod logs)
    test("Verify pod logs are not visible in the Kubernetes tab", async ({
      page,
    }) => {
      await common.loginAsKeycloakUser(
        process.env.QE_USER5_ID,
        process.env.QE_USER5_PASS,
      );

      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Kubernetes");
      await uiHelper.verifyText("backstage-janus");

      await page
        .locator(KUBERNETES_COMPONENTS.MuiAccordion)
        .getByRole("button", { name: "my-cluster Cluster" })
        .click();
      await kubernetes.verifyPodLogs("topology-test", "topology-test");
    });
  });
});
