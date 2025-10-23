import { Page, expect, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../../support/api/rbac-api";
import { Policy } from "../../../support/api/rbac-api-structures";
import { Response } from "../../../support/pages/rbac";

test.describe.serial("Test Orchestrator RBAC", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.describe.serial("Test Orchestrator RBAC API", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    test.beforeEach(async ({}, testInfo) => {
      console.log(
        `beforeEach: Attempting setup for ${testInfo.title}, retry: ${testInfo.retry}`,
      );
    });

    test("Create role with orchestrator.workflow read and update permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const orchestratorRole = {
        memberReferences: members,
        name: "role:default/workflowReadwrite",
      };

      const orchestratorPolicies = [
        {
          entityReference: "role:default/workflowReadwrite",
          permission: "orchestrator.workflow",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: "role:default/workflowReadwrite",
          permission: "orchestrator.workflow.use",
          policy: "update",
          effect: "allow",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(orchestratorRole);
      const policyPostResponse = await rbacApi.createPolicies(orchestratorPolicies);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      
      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();
      
      const roles = await rolesResponse.json();
      const workflowRole = roles.find((role: { name: string; memberReferences: string[] }) => role.name === "role:default/workflowReadwrite");
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");
      
      const policiesResponse = await rbacApi.getPoliciesByRole("default/workflowReadwrite");
      expect(policiesResponse.ok()).toBeTruthy();
      
      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);
      
      const readPolicy = policies.find((policy: { permission: string; policy: string; effect: string }) => policy.permission === "orchestrator.workflow" && policy.policy === "read");
      const updatePolicy = policies.find((policy: { permission: string; policy: string; effect: string }) => policy.permission === "orchestrator.workflow.use" && policy.policy === "update");
      
      expect(readPolicy).toBeDefined();
      expect(updatePolicy).toBeDefined();
      expect(readPolicy.effect).toBe("allow");
      expect(updatePolicy.effect).toBe("allow");
    });

    test("Test orchestrator workflow access is allowed", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      const orchestrator = new Orchestrator(page);
      await orchestrator.selectGreetingWorkflowItem();
      
      // Verify we're on the greeting workflow page
      await expect(
        page.getByRole("heading", { name: "Greeting workflow" }),
      ).toBeVisible();

      // Verify the Run button is visible and enabled
      const runButton = page.getByRole("button", { name: "Run" });
      await expect(runButton).toBeVisible();
      await expect(runButton).toBeEnabled();
      
      // Click the Run button to verify permission works
      await runButton.click();
    });


    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse =
          await rbacApi.getPoliciesByRole("default/workflowReadwrite");

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowReadwrite",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole("default/workflowReadwrite");

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe.serial("Test Orchestrator RBAC: Read-Only Access", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    test.beforeEach(async ({}, testInfo) => {
      console.log(
        `beforeEach: Attempting setup for ${testInfo.title}, retry: ${testInfo.retry}`,
      );
    });

    test("Create role with orchestrator.workflow read-only permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const orchestratorReadonlyRole = {
        memberReferences: members,
        name: "role:default/workflowReadonly",
      };

      const orchestratorReadonlyPolicies = [
        {
          entityReference: "role:default/workflowReadonly",
          permission: "orchestrator.workflow",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: "role:default/workflowReadonly",
          permission: "orchestrator.workflow.use",
          policy: "update",
          effect: "deny",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(orchestratorReadonlyRole);
      const policyPostResponse = await rbacApi.createPolicies(orchestratorReadonlyPolicies);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify read-only role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      
      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();
      
      const roles = await rolesResponse.json();
      const workflowRole = roles.find((role: { name: string; memberReferences: string[] }) => role.name === "role:default/workflowReadonly");
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");
      
      const policiesResponse = await rbacApi.getPoliciesByRole("default/workflowReadonly");
      expect(policiesResponse.ok()).toBeTruthy();
      
      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);
      
      const readPolicy = policies.find((policy: { permission: string; policy: string; effect: string }) => policy.permission === "orchestrator.workflow" && policy.policy === "read");
      const denyUpdatePolicy = policies.find((policy: { permission: string; policy: string; effect: string }) => policy.permission === "orchestrator.workflow.use" && policy.policy === "update");
      
      expect(readPolicy).toBeDefined();
      expect(denyUpdatePolicy).toBeDefined();
      expect(readPolicy.effect).toBe("allow");
      expect(denyUpdatePolicy.effect).toBe("deny");
    });

    test("Test orchestrator workflow read-only access - Run button disabled", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      const orchestrator = new Orchestrator(page);
      await orchestrator.selectGreetingWorkflowItem();
      
      // Verify we're on the greeting workflow page
      await expect(
        page.getByRole("heading", { name: "Greeting workflow" }),
      ).toBeVisible();

      // Verify the Run button is either not visible or disabled (read-only access)
      const runButton = page.getByRole("button", { name: "Run" });
      
      // Check if button exists - it might be disabled or not visible at all
      const buttonCount = await runButton.count();
      
      if (buttonCount > 0) {
        // If button exists, it should be disabled
        await expect(runButton).toBeDisabled();
      } else {
        // Button should not exist for read-only users
        await expect(runButton).toHaveCount(0);
      }
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse =
          await rbacApi.getPoliciesByRole("default/workflowReadonly");

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowReadonly",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole("default/workflowReadonly");

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe.serial("Test Orchestrator RBAC: Denied Access", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    test.beforeEach(async ({}, testInfo) => {
      console.log(
        `beforeEach: Attempting setup for ${testInfo.title}, retry: ${testInfo.retry}`,
      );
    });

    test("Create role with orchestrator.workflow denied permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const orchestratorDeniedRole = {
        memberReferences: members,
        name: "role:default/workflowDenied",
      };

      const orchestratorDeniedPolicies = [
        {
          entityReference: "role:default/workflowDenied",
          permission: "orchestrator.workflow",
          policy: "read",
          effect: "deny",
        },
        {
          entityReference: "role:default/workflowDenied",
          permission: "orchestrator.workflow.use",
          policy: "update",
          effect: "deny",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(orchestratorDeniedRole);
      const policyPostResponse = await rbacApi.createPolicies(orchestratorDeniedPolicies);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify denied role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      
      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();
      
      const roles = await rolesResponse.json();
      const workflowRole = roles.find((role: { name: string; memberReferences: string[] }) => role.name === "role:default/workflowDenied");
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");
      
      const policiesResponse = await rbacApi.getPoliciesByRole("default/workflowDenied");
      expect(policiesResponse.ok()).toBeTruthy();
      
      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);
      
      const denyReadPolicy = policies.find((policy: { permission: string; policy: string; effect: string }) => policy.permission === "orchestrator.workflow" && policy.policy === "read");
      const denyUpdatePolicy = policies.find((policy: { permission: string; policy: string; effect: string }) => policy.permission === "orchestrator.workflow.use" && policy.policy === "update");
      
      expect(denyReadPolicy).toBeDefined();
      expect(denyUpdatePolicy).toBeDefined();
      expect(denyReadPolicy.effect).toBe("deny");
      expect(denyUpdatePolicy.effect).toBe("deny");
    });

    test("Test orchestrator workflow denied access - no workflows visible", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      // With denied access, the workflows table should be empty or show no results
      await uiHelper.verifyTableIsEmpty();
      
      // Alternatively, verify that the Greeting workflow link is not visible
      const greetingWorkflowLink = page.getByRole("link", { name: "Greeting workflow" });
      await expect(greetingWorkflowLink).toHaveCount(0);
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse =
          await rbacApi.getPoliciesByRole("default/workflowDenied");

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowDenied",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole("default/workflowDenied");

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });


});
