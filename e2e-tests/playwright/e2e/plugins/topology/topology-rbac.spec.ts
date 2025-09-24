import { test } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Catalog } from "../../../support/pages/catalog";
import { Topology } from "../../../support/pages/topology";

test.describe("Test Topology Plugin with RBAC", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalog: Catalog;
  let topology: Topology;

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
    topology = new Topology(page);
  });

  test.describe("Verify a user without permissions is not able to access parts of the Topology plugin", () => {
    test.fixme(
      process.env.JOB_NAME.includes("operator"),
      "Failing on Operator, fix https://issues.redhat.com/browse/RHIDP-6492",
    );
    // User is able to read from the catalog
    // User is missing 'kubernetes.clusters.read', 'kubernetes.resources.read', 'kubernetes.proxy' permissions
    test("Verify pods are not visible in the Topology tab", async () => {
      await common.loginAsKeycloakUser(
        process.env.QE_USER6_ID,
        process.env.QE_USER6_PASS,
      );

      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Topology");
      await topology.verifyMissingTopologyPermission();
    });

    // User is able to read from the catalog
    // User has 'kubernetes.clusters.read' and 'kubernetes.resources.read' permissions
    // User is missing 'kubernetes.proxy' permission (needed for pod logs)
    test("Verify pod logs are not visible in the Topology tab", async () => {
      await common.loginAsKeycloakUser(
        process.env.QE_USER5_ID,
        process.env.QE_USER5_PASS,
      );
      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Topology");

      await topology.verifyDeployment("topology-test");
      await topology.verifyPodLogs(false);
    });
  });

  // User is able to read from the catalog
  // User has 'kubernetes.clusters.read', 'kubernetes.resources.read', 'kubernetes.proxy' permissions
  test.describe("Verify a user with permissions is able to access the Topology plugin", () => {
    //Skipping for now as it is failing RHIDP-7164
    test.beforeEach(async () => {
      await common.loginAsKeycloakUser();

      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Topology");
    });

    test("Verify pods visibility in the Topology tab", async () => {
      await topology.verifyDeployment("topology-test");
    });

    test("Verify pod logs visibility in the Topology tab", async () => {
      await topology.verifyDeployment("topology-test");
      await topology.verifyPodLogs(true);
    });
  });
});
