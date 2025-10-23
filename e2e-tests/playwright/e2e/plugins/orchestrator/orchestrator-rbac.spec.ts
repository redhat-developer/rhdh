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


});
