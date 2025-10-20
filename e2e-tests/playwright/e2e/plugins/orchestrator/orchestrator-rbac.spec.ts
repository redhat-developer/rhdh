import { Page, expect, test } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { RbacPo } from "../../../support/page-objects/rbac-po";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../../support/api/rbac-api";
import { Policy } from "../../../support/api/rbac-api-structures";

test.describe.serial("Test Orchestrator RBAC", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.describe("Test Orchestrator RBAC: User Onboarding Workflow", () => {
    let apiToken: string;
    let rbacApi: RhdhRbacApi;

    test.beforeAll(async ({ browser }, testInfo) => {
      const { page } = await browser.newPage();
      const common = new Common(page);
      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
      rbacApi = await RhdhRbacApi.build(apiToken);
      await page.close();
    });

    test.beforeEach(async ({ page }) => {
      await new Common(page).loginAsKeycloakUser();
    });

    test("Create role with orchestrator permissions and test user onboarding workflow access", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const orchestrator = new Orchestrator(page);
      const rbacPo = new RbacPo(page);

      // Create a role with orchestrator permissions
      const testRole = "orchestrator-test-role";
      const members = ["user:default/rhdh-qe"];
      
      const orchestratorPolicy: Policy = {
        entityReference: `role:default/${testRole}`,
        permission: "orchestrator.workflow.execute",
        policy: "use",
        effect: "allow",
      };

      // Create role via API
      const roleResponse = await rbacApi.createRoles({
        memberReferences: members,
        name: `role:default/${testRole}`,
      });

      // Create policy via API
      const policyResponse = await rbacApi.createPolicies([orchestratorPolicy]);

      expect(roleResponse.ok()).toBeTruthy();
      expect(policyResponse.ok()).toBeTruthy();

      // Test orchestrator access
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");
      
      // Test user onboarding workflow access
      await orchestrator.selectUserOnboardingWorkflowItem();
      await expect(page.getByRole("heading", { name: "User Onboarding" })).toBeVisible();
      
      // Verify workflow execution permissions
      await expect(page.getByRole("button", { name: "Start workflow" })).toBeVisible();
    });

    test("Test orchestrator access denied for user without permissions", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const orchestrator = new Orchestrator(page);

      // Create a role that denies orchestrator access
      const denyRole = "orchestrator-deny-role";
      const members = ["user:default/rhdh-qe"];
      
      const denyPolicy: Policy = {
        entityReference: `role:default/${denyRole}`,
        permission: "orchestrator.workflow.execute",
        policy: "use",
        effect: "deny",
      };

      // Create role and policy via API
      await rbacApi.createRoles({
        memberReferences: members,
        name: `role:default/${denyRole}`,
      });
      await rbacApi.createPolicies([denyPolicy]);

      // Test orchestrator access is denied
      await uiHelper.goToPageUrl("/orchestrator");
      
      // Should show access denied or redirect
      await expect(page.getByText("Access denied")).toBeVisible();
    });

    test("Test user onboarding workflow execution with proper RBAC", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const orchestrator = new Orchestrator(page);

      // Navigate to orchestrator
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");
      
      // Select user onboarding workflow
      await orchestrator.selectUserOnboardingWorkflowItem();
      await expect(page.getByRole("heading", { name: "User Onboarding" })).toBeVisible();
      
      // Start the workflow
      await page.getByRole("button", { name: "Start workflow" }).click();
      
      // Verify workflow started successfully
      await expect(page.getByText("Workflow started")).toBeVisible();
      
      // Wait for workflow to complete or show status
      await orchestrator.waitForWorkflowStatus("Completed", 300000);
    });

    test("Test orchestrator workflow abort permissions", async ({ page }) => {
      const uiHelper = new UIhelper(page);
      const orchestrator = new Orchestrator(page);

      // Navigate to orchestrator and start workflow
      await uiHelper.goToPageUrl("/orchestrator");
      await orchestrator.selectUserOnboardingWorkflowItem();
      await page.getByRole("button", { name: "Start workflow" }).click();
      
      // Test abort functionality
      await orchestrator.abortWorkflow();
      await expect(page.getByText("Status Aborted")).toBeVisible();
    });

    test.afterAll(async () => {
      // Cleanup: Delete test roles and policies
      try {
        await rbacApi.deleteRole("default/orchestrator-test-role");
        await rbacApi.deleteRole("default/orchestrator-deny-role");
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    });
  });

  test.describe("Test Orchestrator RBAC: Guest User Access", () => {
    test.beforeEach(async ({ page }) => {
      const common = new Common(page);
      await common.loginAsGuest();
    });

    test("Check if guest user can access orchestrator workflows", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const orchestrator = new Orchestrator(page);

      // Guest user should not have access to orchestrator
      await uiHelper.goToPageUrl("/orchestrator");
      
      // Should show access denied or be redirected
      await expect(page.getByText("Access denied")).toBeVisible();
    });
  });

  test.describe("Test Orchestrator RBAC: Conditional Access Policies", () => {
    test.beforeEach(async ({ page }) => {
      await new Common(page).loginAsKeycloakUser();
    });

    test("Test orchestrator access with conditional policies based on user ownership", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const rbacPo = new RbacPo(page);

      // Create a conditional role for orchestrator access
      await rbacPo.createRBACConditionRole(
        "orchestrator-conditional-role",
        [`${process.env.QE_USER6_ID} ${process.env.QE_USER6_ID}`],
        "user:default/rhdh-qe-6",
      );

      // Test that the user can access orchestrator with conditional permissions
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");
      
      // Verify user can execute workflows they have permission for
      await uiHelper.openSidebar("Orchestrator");
      await expect(page.getByRole("link", { name: "User Onboarding" })).toBeVisible();
    });

    test.afterAll(async ({ page }) => {
      // Cleanup conditional role
      const common = new Common(page);
      await common.loginAsKeycloakUser();
      const rbacPo = new RbacPo(page);
      await rbacPo.deleteRole("role:default/orchestrator-conditional-role");
    });
  });
});
