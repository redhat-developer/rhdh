import { expect, Page, test } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { Common, setupBrowser } from "../../utils/common";
import { APIHelper } from "../../utils/api-helper";
import { BulkImport } from "../../support/pages/bulk-import";
import { CatalogImport } from "../../support/pages/catalog-import";
import {
  DEFAULT_CATALOG_INFO_YAML,
  UPDATED_CATALOG_INFO_YAML,
} from "../../support/test-data/bulk-import";

// Pre-req : plugin-bulk-import & plugin-bulk-import-backend-dynamic
test.describe.serial("Bulk Import plugin", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2116
  test.fixme(() => process.env.JOB_TYPE.includes("presubmit")); // skip on PR checks
  test.fixme(() => !process.env.JOB_NAME.includes("ocp")); // run only on OCP jobs to avoid GH rate limit
  test.describe.configure({ retries: process.env.CI ? 5 : 0 });

  let page: Page;
  let uiHelper: UIhelper;
  let common: Common;

  let bulkimport: BulkImport;

  const catalogRepoName = `janus-test-1-bulk-import-test-${Date.now()}`;
  const catalogRepoDetails = {
    name: catalogRepoName,
    url: `github.com/janus-test/${catalogRepoName}`,
    org: "github.com/janus-test",
    owner: "janus-test",
  };

  const catalogInfoYamlContent = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${catalogRepoName}
  annotations:
    github.com/project-slug: janus-test/${catalogRepoName}
spec:
  type: other
  lifecycle: unknown
  owner: user:default/rhdh-qe-2`;
  const newRepoName = `bulk-import-${Date.now()}`;
  const newRepoDetails = {
    owner: "janus-test",
    repoName: newRepoName,
    updatedComponentName: `${newRepoName}-updated`,
    labels: `bulkimport1: test1;bulkimport2: test2`,
    repoUrl: `github.com/janus-test/${newRepoName}`,
  };

  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    bulkimport = new BulkImport(page);

    // Create the repository with catalog-info.yaml file dynamically
    await APIHelper.createGitHubRepoWithFile(
      catalogRepoDetails.owner,
      catalogRepoDetails.name,
      "catalog-info.yaml",
      catalogInfoYamlContent,
    );

    await bulkimport.newGitHubRepo(
      newRepoDetails.owner,
      newRepoDetails.repoName,
    );
    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
  });

  // Select two repos: one with an existing catalog.yaml file and another without it
  test("Add a Repository from the Repository Tab and Confirm its Preview", async () => {
    await uiHelper.openSidebar("Bulk import");
    await uiHelper.clickButton("Import");
    await uiHelper.searchInputPlaceholder(catalogRepoDetails.name);

    await uiHelper.verifyRowInTableByUniqueText(catalogRepoDetails.name, [
      "Not Generated",
    ]);
    await bulkimport.selectRepoInTable(catalogRepoDetails.name);
    await uiHelper.verifyRowInTableByUniqueText(catalogRepoDetails.name, [
      catalogRepoDetails.url,
      "Ready to import Preview file",
    ]);

    await uiHelper.clickOnLinkInTableByUniqueText(
      catalogRepoDetails.name,
      "Preview file",
    );
    await expect(await uiHelper.clickButton("Save")).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("Add a Repository from the Organization Tab and Confirm its Preview", async () => {
    await uiHelper.clickByDataTestId("organization-view");
    await uiHelper.searchInputPlaceholder(newRepoDetails.owner);
    await uiHelper.verifyRowInTableByUniqueText(newRepoDetails.owner, [
      new RegExp(`github.com/${newRepoDetails.owner}`),
      /1\/(\d+) Edit/,
      /Ready to import Preview file/,
    ]);
    await uiHelper.clickOnLinkInTableByUniqueText(newRepoDetails.owner, "Edit");
    await bulkimport.searchInOrg(newRepoDetails.repoName);
    await bulkimport.selectRepoInTable(newRepoDetails.repoName);
    await uiHelper.clickButton("Select");
    await uiHelper.verifyRowInTableByUniqueText(newRepoDetails.owner, [
      new RegExp(`github.com/${newRepoDetails.owner}`),
      /2\/(\d+) Edit/,
      /Ready to import Preview files/,
    ]);
    await expect(await uiHelper.clickButton("Import")).toBeDisabled({
      timeout: 10000,
    });
  });

  test('Verify that the two selected repositories are listed: one with the status "Already imported" and another with the status "WAIT_PR_APPROVAL."', async () => {
    await common.waitForLoad();
    await bulkimport.filterAddedRepo(catalogRepoDetails.name);
    await uiHelper.verifyRowInTableByUniqueText(catalogRepoDetails.name, [
      catalogRepoDetails.url,
      "Added",
    ]);
    await bulkimport.filterAddedRepo(newRepoDetails.repoName);
    await uiHelper.verifyRowInTableByUniqueText(newRepoDetails.repoName, [
      "Waiting for Approval",
    ]);
  });

  test("Verify the Content of catalog-info.yaml in the PR is Correct", async () => {
    const prCatalogInfoYaml = await APIHelper.getfileContentFromPR(
      newRepoDetails.owner,
      newRepoDetails.repoName,
      1,
      "catalog-info.yaml",
    );
    const expectedCatalogInfoYaml = DEFAULT_CATALOG_INFO_YAML(
      newRepoDetails.repoName,
      `${newRepoDetails.owner}/${newRepoDetails.repoName}`,
      process.env.GH_USER2_ID,
    );
    expect(prCatalogInfoYaml).toEqual(expectedCatalogInfoYaml);
  });

  test("Edit Pull request Details and Ensure PR Content Reflects Changes", async () => {
    await bulkimport.filterAddedRepo(newRepoDetails.repoName);
    await uiHelper.clickOnButtonInTableByUniqueText(
      newRepoDetails.repoName,
      "Update",
    );

    await bulkimport.fillTextInputByNameAtt(
      "componentName",
      newRepoDetails.updatedComponentName,
    );
    await bulkimport.fillTextInputByNameAtt("prLabels", newRepoDetails.labels);
    await expect(await uiHelper.clickButton("Save")).toBeHidden();

    const prCatalogInfoYaml = await APIHelper.getfileContentFromPR(
      newRepoDetails.owner,
      newRepoDetails.repoName,
      1,
      "catalog-info.yaml",
    );
    const expectedCatalogInfoYaml = UPDATED_CATALOG_INFO_YAML(
      newRepoDetails.updatedComponentName,
      `${newRepoDetails.owner}/${newRepoDetails.repoName}`,
      newRepoDetails.labels,
      process.env.GH_USER2_ID,
    );
    expect(prCatalogInfoYaml).toEqual(expectedCatalogInfoYaml);
  });

  test("Verify Selected repositories shows catalog-info.yaml status as 'Already imported' and 'WAIT_PR_APPROVAL'", async () => {
    await uiHelper.openSidebar("Bulk import");
    await uiHelper.clickButton("Import");
    await uiHelper.searchInputPlaceholder(catalogRepoDetails.name);
    await uiHelper.verifyRowInTableByUniqueText(catalogRepoDetails.name, [
      "Already imported",
    ]);
    await uiHelper.searchInputPlaceholder(newRepoDetails.repoName);
    await uiHelper.verifyRowInTableByUniqueText(newRepoDetails.repoName, [
      "Waiting for Approval",
    ]);
  });

  test("Merge the PR on GitHub and Confirm the Status Updates to 'Already imported'", async () => {
    await uiHelper.openSidebar("Bulk import");
    // Merge PR is generated for the repository without the catalog.yaml file.
    await APIHelper.mergeGitHubPR(
      newRepoDetails.owner,
      newRepoDetails.repoName,
      1,
    );
    // Ensure that no PR is generated for the repository that already has a catalog.yaml file.
    expect(
      await APIHelper.getGitHubPRs(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "open",
      ),
    ).toHaveLength(0);

    await bulkimport.filterAddedRepo(newRepoDetails.repoName);
    // verify that the status has changed to "Already imported."
    await uiHelper.clickOnButtonInTableByUniqueText(
      newRepoDetails.repoName,
      "Refresh",
    );
    await uiHelper.verifyRowInTableByUniqueText(newRepoDetails.repoName, [
      "Already imported",
    ]);
  });

  test("Verify Added Repositories Appear in the Catalog as Expected", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.searchInputPlaceholder(catalogRepoDetails.name);
    await uiHelper.verifyRowInTableByUniqueText(catalogRepoDetails.name, [
      "other",
      "unknown",
    ]);
  });

  test("Delete a Bulk Import Repository and Verify It's No Longer Visible in the UI", async () => {
    await uiHelper.openSidebar("Bulk import");
    await common.waitForLoad();
    await bulkimport.filterAddedRepo(catalogRepoDetails.name);
    await uiHelper.clickOnButtonInTableByUniqueText(
      catalogRepoDetails.name,
      "Delete",
    );
    await page.getByRole("button", { name: "Remove" }).click();
    await uiHelper.verifyLink(catalogRepoDetails.url, {
      exact: false,
      notVisible: true,
    });
  });
  test("Verify Deleted Bulk Import Repositories Does not Appear in the Catalog", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");
    await uiHelper.searchInputPlaceholder(catalogRepoDetails.name);
    await uiHelper.verifyLink(catalogRepoDetails.name, {
      notVisible: true,
    });
  });

  test.afterAll(async () => {
    try {
      // Delete the dynamically created GitHub repository with catalog-info.yaml
      await APIHelper.deleteGitHubRepo(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
      );

      // Delete the GitHub repository
      await APIHelper.deleteGitHubRepo(
        newRepoDetails.owner,
        newRepoDetails.repoName,
      );

      console.log(
        `[Cleanup] Deleted GitHub repositories: ${catalogRepoDetails.name}, ${newRepoDetails.repoName}`,
      );
    } catch (error) {
      console.error(`[Cleanup] Final cleanup failed: ${error.message}`);
    }
  });
});

test.describe
  .serial("Bulk Import - Verify existing repo are displayed in bulk import Added repositories", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2116
  test.fixme(() => process.env.JOB_TYPE.includes("presubmit")); // skip on PR checks
  test.fixme(() => !process.env.JOB_NAME.includes("ocp")); // run only on OCP jobs to avoid GH rate limit
  let page: Page;
  let uiHelper: UIhelper;
  let common: Common;
  let bulkimport: BulkImport;
  let catalogImport: CatalogImport;
  const existingRepoFromAppConfig = "janus-test-3-bulk-import";

  const existingComponentDetails = {
    name: "janus-test-2-bulk-import-test",
    repoName: "janus-test-2-bulk-import-test",
    url: "https://github.com/janus-test/janus-test-2-bulk-import-test/blob/main/catalog-info.yaml",
  };
  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    bulkimport = new BulkImport(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
  });

  test("Verify existing repo from app-config is displayed in bulk import Added repositories", async () => {
    await uiHelper.openSidebar("Bulk import");
    await common.waitForLoad();
    await bulkimport.filterAddedRepo(existingRepoFromAppConfig);
    await uiHelper.verifyRowInTableByUniqueText(existingRepoFromAppConfig, [
      "Already imported",
    ]);
  });

  test('Verify repo from "import an existing git repository"  are displayed in bulk import Added repositories', async () => {
    // Import an existing Git repository
    await uiHelper.openSidebar("Catalog");
    await uiHelper.clickButton("Self-service");
    await uiHelper.clickButton("Import an existing Git repository");
    await catalogImport.registerExistingComponent(
      existingComponentDetails.url,
      true,
    );

    // Verify in bulk import's Added Repositories
    await uiHelper.openSidebar("Bulk import");
    await common.waitForLoad();
    await bulkimport.filterAddedRepo(existingComponentDetails.repoName);
    await uiHelper.verifyRowInTableByUniqueText(
      existingComponentDetails.repoName,
      ["Already imported"],
    );
  });
});

test.describe
  .serial("Bulk Import - Ensure users without bulk import permissions cannot access the bulk import plugin", () => {
  test.skip(() => process.env.JOB_NAME.includes("osd-gcp")); // skipping due to RHIDP-5704 on OSD Env
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2116
  test.fixme(() => process.env.JOB_TYPE.includes("presubmit")); // skip on PR checks
  test.fixme(() => !process.env.JOB_NAME.includes("ocp")); // run only on OCP jobs to avoid GH rate limit
  let page: Page;
  let uiHelper: UIhelper;
  let common: Common;
  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsKeycloakUser();
  });

  test("Bulk Import - Verify users without permission cannot access", async () => {
    await uiHelper.openSidebar("Bulk import");
    await uiHelper.verifyText("Permission required");
    expect(await uiHelper.isBtnVisible("Import")).toBeFalsy();
  });
});
