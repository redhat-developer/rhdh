import { test, expect, Page } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Catalog } from "../../../support/pages/catalog";
import { RbacPo } from "../../../support/pageObjects/rbac-po";
import { downloadAndReadFile } from "../../../utils/helper";

test.describe("Test Topology Plugin with RBAC", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let catalog: Catalog;
  let rbacPo: RbacPo;
  let kubernetesRoleName: string | undefined = undefined;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
    catalog = new Catalog(page);
    rbacPo = new RbacPo(page);
  });

  test.afterEach(async () => {
    if (kubernetesRoleName) {
      await common.signOut();
      await common.loginAsKeycloakUser();
      await rbacPo.deleteRole(`role:default/${kubernetesRoleName}`);
      kubernetesRoleName = undefined;
    }
  });

  async function verifyMissingTopologyPermission(page: Page) {
    await catalog.goToBackstageJanusProject();
    await uiHelper.clickTab("Topology");
    await uiHelper.verifyHeading("Missing Permission");
    await uiHelper.verifyText("kubernetes.clusters.read");
    await uiHelper.verifyText("kubernetes.resources.read");
    await expect(page.getByLabel("Pod")).not.toBeVisible();
  }

  test("Missing all Kubernetes permissions", async ({ page }) => {
    await common.loginAsKeycloakUser(
      process.env.QE_USER6_ID,
      process.env.QE_USER6_PASS,
    );
    await verifyMissingTopologyPermission(page);
  });

  test("Insufficient permissions: missing 'kubernetes.clusters.read'", async ({
    page,
  }) => {
    kubernetesRoleName = "kubernetes_resources_viewer";
    await common.loginAsKeycloakUser();
    await rbacPo.createRole(
      kubernetesRoleName,
      [RbacPo.rbacTestUsers.rhdhqe6],
      [],
      [{ permission: "kubernetes.resources.read" }],
      "kubernetes",
    );
    await common.signOut();
    await common.loginAsKeycloakUser(
      process.env.QE_USER6_ID,
      process.env.QE_USER6_PASS,
    );
    await verifyMissingTopologyPermission(page);
  });

  test("Insufficient permissions: missing 'kubernetes.resources.read'", async ({
    page,
  }) => {
    kubernetesRoleName = "kubernetes_clusters_viewer";
    await rbacPo.createRole(
      kubernetesRoleName,
      [RbacPo.rbacTestUsers.rhdhqe6],
      [],
      [{ permission: "kubernetes.clusters.read" }],
      "kubernetes",
    );
    await common.signOut();
    await common.loginAsKeycloakUser(
      process.env.QE_USER6_ID,
      process.env.QE_USER6_PASS,
    );
    await verifyMissingTopologyPermission(page);
  });

  test("Authorized topology user without 'kubernetes.proxy' permission is able to view Topology information but not logs", async ({
    page,
  }) => {
    await common.loginAsKeycloakUser(
      process.env.QE_USER5_ID,
      process.env.QE_USER5_PASS,
    );
    await catalog.goToBackstageJanusProject();
    await uiHelper.clickTab("Topology");
    await page.locator("[data-test-id=topology-test] image").first().click();
    await page.getByLabel("Pod").click();
    await uiHelper.clickTab("Resources");
    await page.locator('button:has(span:text("View Logs"))').first().click();
    await uiHelper.verifyHeading("Missing Permission");
    await uiHelper.verifyText("kubernetes.proxy");
  });

  test("Authorized topology user with 'kubernetes.proxy' permission is able to view Topology logs", async ({
    page,
  }) => {
    await common.loginAsKeycloakUser();
    await catalog.goToBackstageJanusProject();
    await uiHelper.clickTab("Topology");
    await page.locator("[data-test-id=topology-test] image").first().click();
    await page.getByLabel("Pod").click();
    await uiHelper.clickTab("Resources");
    await page.locator('button:has(span:text("View Logs"))').first().click();
    const fileContent = await downloadAndReadFile(
      page,
      'role=button[name="download logs"]',
    );
    expect(fileContent).not.toBeUndefined();
    expect(fileContent).not.toBe("");
  });
});
