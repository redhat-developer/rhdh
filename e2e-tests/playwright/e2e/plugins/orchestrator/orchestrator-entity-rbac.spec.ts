import { Page, expect, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../../support/api/rbac-api";
import { Policy } from "../../../support/api/rbac-api-structures";
import { Response } from "../../../support/pages/rbac";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

/**
 * Orchestrator Entity-Workflow RBAC Tests
 *
 * Test Cases: RHIDP-11839, RHIDP-11840
 *
 * These tests verify the RBAC boundary between template execution and
 * workflow execution in the context of entity-workflow integration.
 *
 * Important: These tests should run in the SHOWCASE_RBAC project since
 * they require permission.enabled: true.
 *
 * Templates used (from catalog locations):
 * - greeting_w_component.yaml: name=greetingComponent, title="Greeting Test Picker" - HAS annotation
 */
test.describe.serial("Orchestrator Entity-Workflow RBAC", () => {
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2184 fix orchestrator tests on Operator deployment
  test.fixme(() => skipIfJobName(JOB_NAME_PATTERNS.OPERATOR));

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.describe
    .serial("RHIDP-11839: Template run WITHOUT workflow permissions", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;
    const roleName = "role:default/catalogSuperuserNoWorkflowTest";

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;
      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    test("Setup: Create role with catalog+scaffolder but NO orchestrator permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const role = {
        memberReferences: members,
        name: roleName,
      };

      const policies = [
        // Catalog permissions
        {
          entityReference: roleName,
          permission: "catalog-entity",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "catalog.entity.create",
          policy: "create",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "catalog.location.read",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "catalog.location.create",
          policy: "create",
          effect: "allow",
        },
        // Scaffolder permissions
        {
          entityReference: roleName,
          permission: "scaffolder.action.execute",
          policy: "use",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "scaffolder.task.create",
          policy: "create",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "scaffolder.task.read",
          policy: "read",
          effect: "allow",
        },
        // Explicitly DENY orchestrator permissions
        {
          entityReference: roleName,
          permission: "orchestrator.workflow",
          policy: "read",
          effect: "deny",
        },
        {
          entityReference: roleName,
          permission: "orchestrator.workflow.use",
          policy: "update",
          effect: "deny",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(role);
      const policyPostResponse = await rbacApi.createPolicies(policies);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Launch template and attempt to run workflow - verify unauthorized", async () => {
      // Navigate directly to the template form (greeting_w_component.yaml)
      await page.goto("/create/templates/default/greetingComponent");

      // Step 1: Fill in workflow parameters
      const languageField = page.getByLabel("Language");
      await expect(languageField).toBeVisible({ timeout: 30000 });
      await languageField.click();
      await page.getByRole("option", { name: "English" }).click();

      const nameField = page.getByLabel("Name");
      await expect(nameField).toBeVisible({ timeout: 10000 });
      await nameField.fill(`test-rbac-deny-${Date.now()}`);

      // Click Next to proceed to the Review step
      const nextButton = page.getByRole("button", { name: "Next" });
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      await nextButton.click();

      // Click Create to execute
      const createButton = page.getByRole("button", { name: "Create" });
      await expect(createButton).toBeVisible({ timeout: 10000 });
      await createButton.click();

      // Template execution should succeed, but workflow execution should be denied
      // Look for either:
      // 1. An error message about unauthorized/denied/permission
      // 2. The workflow step failing

      // Wait for some result
      await page.waitForTimeout(10000);

      // Check for error indicators
      const errorIndicators = [
        page.getByText(/unauthorized/i),
        page.getByText(/denied/i),
        page.getByText(/permission/i),
        page.getByText(/forbidden/i),
        page.getByText(/failed/i),
      ];

      let hasError = false;
      for (const indicator of errorIndicators) {
        if ((await indicator.count()) > 0) {
          hasError = true;
          break;
        }
      }

      // If no explicit error, verify workflow is not accessible in Orchestrator
      if (!hasError) {
        await uiHelper.openSidebar("Orchestrator");
        await expect(
          page.getByRole("heading", { name: "Workflows" }),
        ).toBeVisible();

        // With denied permissions, workflows should not be visible or accessible
        const greetingWorkflow = page.getByRole("link", {
          name: "Greeting workflow",
        });
        // Either the workflow is not visible, or clicking it shows an error
        const workflowCount = await greetingWorkflow.count();
        expect(workflowCount).toBe(0);
      }
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const roleNameForApi = roleName.replace("role:", "");
        const policiesResponse =
          await rbacApi.getPoliciesByRole(roleNameForApi);

        if (policiesResponse.ok()) {
          const policies =
            await Response.removeMetadataFromResponse(policiesResponse);
          await rbacApi.deletePolicy(roleNameForApi, policies as Policy[]);
          await rbacApi.deleteRole(roleNameForApi);
        }
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    });
  });

  test.describe
    .serial("RHIDP-11840: Template run WITH workflow permissions", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;
    const roleName = "role:default/catalogSuperuserWithWorkflowTest";

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;
      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    test("Setup: Create role with catalog+scaffolder+orchestrator permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const role = {
        memberReferences: members,
        name: roleName,
      };

      const policies = [
        // Catalog permissions
        {
          entityReference: roleName,
          permission: "catalog-entity",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "catalog.entity.create",
          policy: "create",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "catalog.location.read",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "catalog.location.create",
          policy: "create",
          effect: "allow",
        },
        // Scaffolder permissions
        {
          entityReference: roleName,
          permission: "scaffolder.action.execute",
          policy: "use",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "scaffolder.task.create",
          policy: "create",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "scaffolder.task.read",
          policy: "read",
          effect: "allow",
        },
        // Orchestrator permissions - ALLOW
        {
          entityReference: roleName,
          permission: "orchestrator.workflow",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: roleName,
          permission: "orchestrator.workflow.use",
          policy: "update",
          effect: "allow",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(role);
      const policyPostResponse = await rbacApi.createPolicies(policies);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Launch template and run workflow - verify success", async () => {
      // Navigate directly to the template form (greeting_w_component.yaml)
      await page.goto("/create/templates/default/greetingComponent");

      // Step 1: Fill in workflow parameters
      const languageField = page.getByLabel("Language");
      await expect(languageField).toBeVisible({ timeout: 30000 });
      await languageField.click();
      await page.getByRole("option", { name: "English" }).click();

      const nameField = page.getByLabel("Name");
      await expect(nameField).toBeVisible({ timeout: 10000 });
      await nameField.fill(`test-rbac-allow-${Date.now()}`);

      // Click Next to proceed to the Review step
      const nextButton = page.getByRole("button", { name: "Next" });
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      await nextButton.click();

      // Click Create to execute
      const createButton = page.getByRole("button", { name: "Create" });
      await expect(createButton).toBeVisible({ timeout: 10000 });
      await createButton.click();

      // Wait for the scaffolder task to complete. The "Start Over" button appears
      // on both success and failure, so we include it to avoid a 120s timeout if
      // the task fails fast.
      const viewInCatalog = page.getByRole("link", {
        name: "View in catalog",
      });
      const openWorkflowRun = page.getByRole("link", {
        name: "Open workflow run",
      });
      const startOver = page.getByRole("button", { name: "Start Over" });

      await expect(viewInCatalog.or(openWorkflowRun).or(startOver)).toBeVisible(
        {
          timeout: 120000,
        },
      );

      // Verify the task actually succeeded. The output links "View in catalog"
      // and "Open workflow run" are defined in the greeting_w_component.yaml
      // template and are only rendered when all scaffolder steps pass.
      // If the workflow was denied (e.g. missing RBAC permissions), the step
      // fails and only "Start Over" is shown — this assertion catches that.
      await expect(viewInCatalog.or(openWorkflowRun)).toBeVisible({
        timeout: 10000,
      });
    });

    test("Verify workflow run appears in Orchestrator", async () => {
      // Navigate to Orchestrator page via sidebar
      await uiHelper.openSidebar("Orchestrator");
      await expect(
        page.getByRole("heading", { name: "Workflows" }),
      ).toBeVisible();

      // Verify workflows are visible (with proper permissions)
      const greetingWorkflow = page.getByRole("link", {
        name: /Greeting workflow/i,
      });
      await expect(greetingWorkflow).toBeVisible({ timeout: 30000 });

      // Click to view workflow details
      await greetingWorkflow.click();

      // Verify we can see the workflow page
      await expect(
        page.getByRole("heading", { name: /Greeting workflow/i }),
      ).toBeVisible();

      // Verify Run button is enabled (we have update permissions)
      const runButton = page.getByRole("button", { name: "Run" });
      await expect(runButton).toBeVisible();
      await expect(runButton).toBeEnabled();
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const roleNameForApi = roleName.replace("role:", "");
        const policiesResponse =
          await rbacApi.getPoliciesByRole(roleNameForApi);

        if (policiesResponse.ok()) {
          const policies =
            await Response.removeMetadataFromResponse(policiesResponse);
          await rbacApi.deletePolicy(roleNameForApi, policies as Policy[]);
          await rbacApi.deleteRole(roleNameForApi);
        }
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    });
  });
});
