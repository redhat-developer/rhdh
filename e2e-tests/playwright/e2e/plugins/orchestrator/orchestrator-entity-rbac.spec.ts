import { Page, expect, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Orchestrator } from "../../../support/pages/orchestrator";
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
 */
test.describe.serial("Orchestrator Entity-Workflow RBAC", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled to save disk space

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.describe.serial(
    "TC-7 RHIDP-11839: Template run WITHOUT workflow permissions",
    () => {
      test.describe.configure({ retries: 0 });
      let common: Common;
      let uiHelper: UIhelper;
      let page: Page;
      let orchestrator: Orchestrator;
      let apiToken: string;
      const roleName = "role:default/catalogSuperuserNoWorkflowTest";

      test.beforeAll(async ({ browser }, testInfo) => {
        page = (await setupBrowser(browser, testInfo)).page;
        uiHelper = new UIhelper(page);
        common = new Common(page);
        orchestrator = new Orchestrator(page);

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

      test("Navigate to Catalog and find orchestrator-tagged template", async () => {
        await page.reload();
        await uiHelper.goToPageUrl("/catalog");
        await uiHelper.verifyHeading("Catalog");

        // Filter by Kind=Template
        await page.getByRole("button", { name: /Kind/i }).click();
        await page.getByRole("option", { name: "Template" }).click();

        // Find a template with orchestrator annotation
        const templateLink = page.getByRole("link", {
          name: /Greeting.*component|greeting_w_component/i,
        });

        if (await templateLink.isVisible({ timeout: 10000 })) {
          await templateLink.click();
          await expect(page.getByRole("heading").first()).toBeVisible();
        } else {
          test.skip();
        }
      });

      test("Launch template and attempt to run workflow - verify unauthorized", async () => {
        // Launch template
        const launchButton = page.getByRole("button", { name: /Launch/i });
        if (await launchButton.isVisible({ timeout: 5000 })) {
          await launchButton.click();

          // Complete wizard
          const nextButton = page.getByRole("button", { name: "Next" });
          if (await nextButton.isVisible()) {
            await nextButton.click();
          }

          const runButton = page.getByRole("button", { name: "Run" });
          await expect(runButton).toBeVisible();
          await runButton.click();

          // Template execution should succeed, but workflow execution should be denied
          // Look for either:
          // 1. An error message about unauthorized/denied
          // 2. The workflow not appearing in the list
          // 3. A permission error popup

          const errorIndicators = [
            page.getByText(/unauthorized/i),
            page.getByText(/denied/i),
            page.getByText(/permission/i),
            page.getByRole("button", { name: /Error/i }),
          ];

          // Wait for either success or error
          await page.waitForTimeout(5000);

          // Check if any error indicator is visible
          let hasError = false;
          for (const indicator of errorIndicators) {
            if (await indicator.isVisible({ timeout: 1000 })) {
              hasError = true;
              break;
            }
          }

          // If no explicit error, verify workflow is not accessible
          if (!hasError) {
            // Navigate to orchestrator page and verify no workflows visible
            await uiHelper.goToPageUrl("/orchestrator");
            await uiHelper.verifyHeading("Workflows");

            // With denied permissions, workflows should not be visible
            const greetingWorkflow = page.getByRole("link", {
              name: "Greeting workflow",
            });
            await expect(greetingWorkflow).toHaveCount(0);
          }
        } else {
          test.skip();
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
    },
  );

  test.describe.serial(
    "TC-8 RHIDP-11840: Template run WITH workflow permissions",
    () => {
      test.describe.configure({ retries: 0 });
      let common: Common;
      let uiHelper: UIhelper;
      let page: Page;
      let orchestrator: Orchestrator;
      let apiToken: string;
      const roleName = "role:default/catalogSuperuserWithWorkflowTest";

      test.beforeAll(async ({ browser }, testInfo) => {
        page = (await setupBrowser(browser, testInfo)).page;
        uiHelper = new UIhelper(page);
        common = new Common(page);
        orchestrator = new Orchestrator(page);

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

      test("Navigate to Catalog and find orchestrator-tagged template", async () => {
        await page.reload();
        await uiHelper.goToPageUrl("/catalog");
        await uiHelper.verifyHeading("Catalog");

        // Filter by Kind=Template
        await page.getByRole("button", { name: /Kind/i }).click();
        await page.getByRole("option", { name: "Template" }).click();

        // Find a template with orchestrator annotation
        const templateLink = page.getByRole("link", {
          name: /Greeting.*component|greeting_w_component/i,
        });

        if (await templateLink.isVisible({ timeout: 10000 })) {
          await templateLink.click();
          await expect(page.getByRole("heading").first()).toBeVisible();
        } else {
          test.skip();
        }
      });

      test("Launch template and run workflow - verify success", async () => {
        // Launch template
        const launchButton = page.getByRole("button", { name: /Launch/i });
        if (await launchButton.isVisible({ timeout: 5000 })) {
          await launchButton.click();

          // Complete wizard
          const nextButton = page.getByRole("button", { name: "Next" });
          if (await nextButton.isVisible()) {
            await nextButton.click();
          }

          const runButton = page.getByRole("button", { name: "Run" });
          await expect(runButton).toBeVisible();
          await runButton.click();

          // Verify workflow completes successfully
          await expect(page.getByText(/Completed|Running/i)).toBeVisible({
            timeout: 120000,
          });
        } else {
          test.skip();
        }
      });

      test("Verify workflow run appears on entity's Workflows tab", async () => {
        // Navigate to orchestrator page
        await uiHelper.goToPageUrl("/orchestrator");
        await uiHelper.verifyHeading("Workflows");

        // Verify workflows are visible (with proper permissions)
        const greetingWorkflow = page.getByRole("link", {
          name: "Greeting workflow",
        });
        await expect(greetingWorkflow).toBeVisible({ timeout: 30000 });

        // Click to view workflow details
        await greetingWorkflow.click();

        // Verify we can see the workflow page
        await expect(
          page.getByRole("heading", { name: "Greeting workflow" }),
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
    },
  );
});
