import { test } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Catalog } from "../../../support/pages/catalog";
import { RbacPo } from "../../../support/pageObjects/rbac-po";
import { Topology } from "../../../support/pages/topology";

test.describe("Test Topology Plugin with RBAC", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalog: Catalog;
  let rbacPo: RbacPo;
  let topology: Topology;

  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.retry > 0) {
      // progressively increase test timeout for retries
      test.setTimeout(testInfo.timeout + testInfo.timeout * 0.25);
    }
    common = new Common(page);
    uiHelper = new UIhelper(page);
    catalog = new Catalog(page);
    rbacPo = new RbacPo(page);
    topology = new Topology(page);
  });

  test.describe("Verify a user without permissions is not able to access parts of the Topology plugin", () => {
    let kubernetesRoleName: string | undefined = undefined;

    test.afterEach(async () => {
      if (kubernetesRoleName) {
        await uiHelper.goToSettingsPage();
        await common.signOut();
        await common.loginAsKeycloakUser();
        await rbacPo.deleteRole(`role:default/${kubernetesRoleName}`);
        kubernetesRoleName = undefined;
      }
    });

    // User is able to read from the catalog
    [
      { permission: undefined }, // missing 'kubernetes.clusters.read', 'kubernetes.resources.read', 'kubernetes.proxy'
      { permission: "kubernetes.resources.read" }, // missing 'kubernetes.clusters.read', 'kubernetes.proxy'
      { permission: "kubernetes.clusters.read" }, // missing 'kubernetes.resources.read', 'kubernetes.proxy'
    ].forEach(({ permission }) => {
      test(`Verify pods are not visible in the Topology tab with ${permission ? "only " + permission : "no"} permission`, async ({
        page,
      }) => {
        if (permission) {
          // create role with permission
          kubernetesRoleName = "kubernetes_viewer";
          await common.loginAsKeycloakUser();
          await page.goto("/rbac");
          await rbacPo.createRole(
            kubernetesRoleName,
            [RbacPo.rbacTestUsers.rhdhqe6],
            [],
            [{ permission }],
            "kubernetes",
          );
          await uiHelper.goToSettingsPage();
          await common.signOut();
        }

        await common.loginAsKeycloakUser(
          process.env.QE_USER6_ID,
          process.env.QE_USER6_PASS,
        );

        await catalog.goToBackstageJanusProject();
        await uiHelper.clickTab("Topology");
        await topology.verifyMissingTopologyPermission();
      });
    });

    // User is able to read from the catalog
    // User is missing 'kubernetes.proxy' permission (needed for pod logs)
    test("Verify pod logs are not visible in the Topology tab", async () => {
      await common.loginAsKeycloakUser(
        process.env.QE_USER5_ID,
        process.env.QE_USER5_PASS,
      );
      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Topology");

      await topology.verifyPodLogs(false);
    });
  });

  // User is able to read from the catalog
  // User has 'kubernetes.clusters.read', 'kubernetes.resources.read', 'kubernetes.proxy' permissions
  test.describe("Verify a user with permissions is able to access the Topology plugin", () => {
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
