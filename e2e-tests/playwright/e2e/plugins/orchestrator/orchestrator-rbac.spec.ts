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

test.describe.serial("Test Orchestrator RBAC", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled to save disk space

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.describe.serial("Test Orchestrator RBAC: Global Workflow Access", () => {
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

    test("Create role with global orchestrator.workflow read and update permissions", async () => {
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
      const policyPostResponse =
        await rbacApi.createPolicies(orchestratorPolicies);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === "role:default/workflowReadwrite",
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");

      const policiesResponse = await rbacApi.getPoliciesByRole(
        "default/workflowReadwrite",
      );
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const readPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow" &&
          policy.policy === "read",
      );
      const updatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use" &&
          policy.policy === "update",
      );

      expect(readPolicy).toBeDefined();
      expect(updatePolicy).toBeDefined();
      expect(readPolicy.effect).toBe("allow");
      expect(updatePolicy.effect).toBe("allow");
    });

    test("Test global orchestrator workflow access is allowed", async () => {
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
        const remainingPoliciesResponse = await rbacApi.getPoliciesByRole(
          "default/workflowReadwrite",
        );

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowReadwrite",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole(
          "default/workflowReadwrite",
        );

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe
    .serial("Test Orchestrator RBAC: Global Workflow Read-Only Access", () => {
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

    test("Create role with global orchestrator.workflow read-only permissions", async () => {
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

      const rolePostResponse = await rbacApi.createRoles(
        orchestratorReadonlyRole,
      );
      const policyPostResponse = await rbacApi.createPolicies(
        orchestratorReadonlyPolicies,
      );

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify read-only role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === "role:default/workflowReadonly",
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");

      const policiesResponse = await rbacApi.getPoliciesByRole(
        "default/workflowReadonly",
      );
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const readPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow" &&
          policy.policy === "read",
      );
      const denyUpdatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use" &&
          policy.policy === "update",
      );

      expect(readPolicy).toBeDefined();
      expect(denyUpdatePolicy).toBeDefined();
      expect(readPolicy.effect).toBe("allow");
      expect(denyUpdatePolicy.effect).toBe("deny");
    });

    test("Test global orchestrator workflow read-only access - Run button disabled", async () => {
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

      // For read-only access, the button should either not exist or be disabled
      const buttonCount = await runButton.count();

      // Test that either button doesn't exist OR it's disabled
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (buttonCount === 0) {
        // Button doesn't exist - this is valid for read-only access
        // eslint-disable-next-line playwright/no-conditional-expect
        expect(buttonCount).toBe(0);
      } else {
        // Button exists - it should be disabled
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(runButton).toBeDisabled();
      }
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse = await rbacApi.getPoliciesByRole(
          "default/workflowReadonly",
        );

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

  test.describe
    .serial("Test Orchestrator RBAC: Global Workflow Denied Access", () => {
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

    test("Create role with global orchestrator.workflow denied permissions", async () => {
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

      const rolePostResponse = await rbacApi.createRoles(
        orchestratorDeniedRole,
      );
      const policyPostResponse = await rbacApi.createPolicies(
        orchestratorDeniedPolicies,
      );

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify denied role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === "role:default/workflowDenied",
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");

      const policiesResponse = await rbacApi.getPoliciesByRole(
        "default/workflowDenied",
      );
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const denyReadPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow" &&
          policy.policy === "read",
      );
      const denyUpdatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use" &&
          policy.policy === "update",
      );

      expect(denyReadPolicy).toBeDefined();
      expect(denyUpdatePolicy).toBeDefined();
      expect(denyReadPolicy.effect).toBe("deny");
      expect(denyUpdatePolicy.effect).toBe("deny");
    });

    test("Test global orchestrator workflow denied access - no workflows visible", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      // With denied access, the workflows table should be empty or show no results
      await uiHelper.verifyTableIsEmpty();

      // Alternatively, verify that the Greeting workflow link is not visible
      const greetingWorkflowLink = page.getByRole("link", {
        name: "Greeting workflow",
      });
      await expect(greetingWorkflowLink).toHaveCount(0);
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse = await rbacApi.getPoliciesByRole(
          "default/workflowDenied",
        );

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

  test.describe
    .serial("Test Orchestrator RBAC: Individual Workflow Denied Access", () => {
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

    test("Create role with greeting workflow denied permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const greetingDeniedRole = {
        memberReferences: members,
        name: "role:default/workflowGreetingDenied",
      };

      const greetingDeniedPolicies = [
        {
          entityReference: "role:default/workflowGreetingDenied",
          permission: "orchestrator.workflow.greeting",
          policy: "read",
          effect: "deny",
        },
        {
          entityReference: "role:default/workflowGreetingDenied",
          permission: "orchestrator.workflow.use.greeting",
          policy: "update",
          effect: "deny",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(greetingDeniedRole);
      const policyPostResponse = await rbacApi.createPolicies(
        greetingDeniedPolicies,
      );

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify greeting workflow denied role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === "role:default/workflowGreetingDenied",
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");

      const policiesResponse = await rbacApi.getPoliciesByRole(
        "default/workflowGreetingDenied",
      );
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const denyReadPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.greeting" &&
          policy.policy === "read",
      );
      const denyUpdatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use.greeting" &&
          policy.policy === "update",
      );

      expect(denyReadPolicy).toBeDefined();
      expect(denyUpdatePolicy).toBeDefined();
      expect(denyReadPolicy.effect).toBe("deny");
      expect(denyUpdatePolicy.effect).toBe("deny");
    });

    test("Test individual workflow denied access - no workflows visible", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      // Verify that the Greeting workflow link is NOT visible (denied)
      const greetingWorkflowLink = page.getByRole("link", {
        name: "Greeting workflow",
      });
      await expect(greetingWorkflowLink).toHaveCount(0);

      // Verify that User Onboarding workflow is also NOT visible (no global permissions)
      const userOnboardingLink = page.getByRole("link", {
        name: "User Onboarding",
      });
      await expect(userOnboardingLink).toHaveCount(0);

      // Verify workflows table is empty (no workflows visible due to individual deny + no global allow)
      await uiHelper.verifyTableIsEmpty();
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse = await rbacApi.getPoliciesByRole(
          "default/workflowGreetingDenied",
        );

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowGreetingDenied",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole(
          "default/workflowGreetingDenied",
        );

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe
    .serial("Test Orchestrator RBAC: Individual Workflow Read-Write Access", () => {
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

    test("Create role with greeting workflow read-write permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const greetingReadwriteRole = {
        memberReferences: members,
        name: "role:default/workflowGreetingReadwrite",
      };

      const greetingReadwritePolicies = [
        {
          entityReference: "role:default/workflowGreetingReadwrite",
          permission: "orchestrator.workflow.greeting",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: "role:default/workflowGreetingReadwrite",
          permission: "orchestrator.workflow.use.greeting",
          policy: "update",
          effect: "allow",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(greetingReadwriteRole);
      const policyPostResponse = await rbacApi.createPolicies(
        greetingReadwritePolicies,
      );

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify greeting workflow read-write role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === "role:default/workflowGreetingReadwrite",
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");

      const policiesResponse = await rbacApi.getPoliciesByRole(
        "default/workflowGreetingReadwrite",
      );
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const allowReadPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.greeting" &&
          policy.policy === "read",
      );
      const allowUpdatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use.greeting" &&
          policy.policy === "update",
      );

      expect(allowReadPolicy).toBeDefined();
      expect(allowUpdatePolicy).toBeDefined();
      expect(allowReadPolicy.effect).toBe("allow");
      expect(allowUpdatePolicy.effect).toBe("allow");
    });

    test("Test individual workflow read-write access - only Greeting workflow visible and runnable", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      // Verify that the Greeting workflow link IS visible (allowed)
      const greetingWorkflowLink = page.getByRole("link", {
        name: "Greeting workflow",
      });
      await expect(greetingWorkflowLink).toBeVisible();

      // Verify that User Onboarding workflow is NOT visible (no global permissions)
      const userOnboardingLink = page.getByRole("link", {
        name: "User Onboarding",
      });
      await expect(userOnboardingLink).toHaveCount(0);

      // Navigate to Greeting workflow and verify we can run it
      await greetingWorkflowLink.click();
      await expect(
        page.getByRole("heading", { name: "Greeting workflow" }),
      ).toBeVisible();

      const runButton = page.getByRole("button", { name: "Run" });
      await expect(runButton).toBeVisible();
      await expect(runButton).toBeEnabled();
      await runButton.click();
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse = await rbacApi.getPoliciesByRole(
          "default/workflowGreetingReadwrite",
        );

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowGreetingReadwrite",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole(
          "default/workflowGreetingReadwrite",
        );

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe
    .serial("Test Orchestrator RBAC: Individual Workflow Read-Only Access", () => {
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

    test("Create role with greeting workflow read-only permissions", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const greetingReadonlyRole = {
        memberReferences: members,
        name: "role:default/workflowGreetingReadonly",
      };

      const greetingReadonlyPolicies = [
        {
          entityReference: "role:default/workflowGreetingReadonly",
          permission: "orchestrator.workflow.greeting",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: "role:default/workflowGreetingReadonly",
          permission: "orchestrator.workflow.use.greeting",
          policy: "update",
          effect: "deny",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(greetingReadonlyRole);
      const policyPostResponse = await rbacApi.createPolicies(
        greetingReadonlyPolicies,
      );

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Verify greeting workflow read-only role exists via API", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === "role:default/workflowGreetingReadonly",
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");

      const policiesResponse = await rbacApi.getPoliciesByRole(
        "default/workflowGreetingReadonly",
      );
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const allowReadPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.greeting" &&
          policy.policy === "read",
      );
      const denyUpdatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use.greeting" &&
          policy.policy === "update",
      );

      expect(allowReadPolicy).toBeDefined();
      expect(denyUpdatePolicy).toBeDefined();
      expect(allowReadPolicy.effect).toBe("allow");
      expect(denyUpdatePolicy.effect).toBe("deny");
    });

    test("Test individual workflow read-only access - only Greeting workflow visible, Run button disabled", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      // Verify that the Greeting workflow link IS visible (allowed)
      const greetingWorkflowLink = page.getByRole("link", {
        name: "Greeting workflow",
      });
      await expect(greetingWorkflowLink).toBeVisible();

      // Verify that User Onboarding workflow is NOT visible (no global permissions)
      const userOnboardingLink = page.getByRole("link", {
        name: "User Onboarding",
      });
      await expect(userOnboardingLink).toHaveCount(0);

      // Navigate to Greeting workflow and verify Run button is disabled/not visible
      await greetingWorkflowLink.click();
      await expect(
        page.getByRole("heading", { name: "Greeting workflow" }),
      ).toBeVisible();

      const runButton = page.getByRole("button", { name: "Run" });
      const buttonCount = await runButton.count();

      // For read-only access, the button should either not exist or be disabled
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (buttonCount === 0) {
        // Button doesn't exist - this is valid for read-only access
        // eslint-disable-next-line playwright/no-conditional-expect
        expect(buttonCount).toBe(0);
      } else {
        // Button exists - it should be disabled
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(runButton).toBeDisabled();
      }
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse = await rbacApi.getPoliciesByRole(
          "default/workflowGreetingReadonly",
        );

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/workflowGreetingReadonly",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole(
          "default/workflowGreetingReadonly",
        );

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe
    .serial("Test Orchestrator RBAC: Workflow Instance Initiator Access and Admin Override", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;
    let workflowInstanceId: string;
    let workflowUserRoleName: string;
    let workflowAdminRoleName: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);

      // Clean up any lingering roles from previous test runs
      const rbacApi = await RhdhRbacApi.build(apiToken);
      try {
        const rolesResponse = await rbacApi.getRoles();
        if (rolesResponse.ok()) {
          const roles = await rolesResponse.json();
          const lingeringRoles = roles.filter(
            (role: { name: string }) =>
              role.name.includes("workflowUser") ||
              role.name.includes("workflowAdmin"),
          );

          console.log(
            `Found ${lingeringRoles.length} lingering roles to clean up`,
          );

          for (const role of lingeringRoles) {
            try {
              console.log(`Cleaning up lingering role: ${role.name}`);
              const roleNameForApi = role.name.replace("role:", "");
              const policiesResponse =
                await rbacApi.getPoliciesByRole(roleNameForApi);
              if (policiesResponse.ok()) {
                const policies =
                  await Response.removeMetadataFromResponse(policiesResponse);
                await rbacApi.deletePolicy(
                  roleNameForApi,
                  policies as Policy[],
                );
              }
              await rbacApi.deleteRole(roleNameForApi);
              console.log(`Successfully cleaned up role: ${role.name}`);
            } catch (error) {
              console.log(
                `Error cleaning up lingering role ${role.name}: ${error}`,
              );
            }
          }
        }
      } catch (error) {
        console.log("Error during pre-test cleanup:", error);
      }
    });

    test.beforeEach(async ({}, testInfo) => {
      console.log(
        `beforeEach: Attempting setup for ${testInfo.title}, retry: ${testInfo.retry}`,
      );
    });

    // Helper function to delete a role if it exists
    async function deleteRoleIfExists(rbacApi: RhdhRbacApi, roleName: string) {
      try {
        const roleNameForApi = roleName.replace("role:", "");
        const rolesResponse = await rbacApi.getRoles();
        if (rolesResponse.ok()) {
          const roles = await rolesResponse.json();
          const existingRole = roles.find(
            (role: { name: string }) => role.name === roleName,
          );

          if (existingRole) {
            console.log(`Deleting existing role: ${roleName}`);
            // Delete policies first
            const policiesResponse =
              await rbacApi.getPoliciesByRole(roleNameForApi);
            if (policiesResponse.ok()) {
              const policies =
                await Response.removeMetadataFromResponse(policiesResponse);
              await rbacApi.deletePolicy(roleNameForApi, policies as Policy[]);
            }
            // Then delete role
            await rbacApi.deleteRole(roleNameForApi);
            console.log(`Successfully deleted role: ${roleName}`);
          }
        }
      } catch (error) {
        console.log(`Error deleting role ${roleName}: ${error}`);
      }
    }

    test("Clean up any existing workflowUser role", async () => {
      workflowUserRoleName = `role:default/workflowUser`;
      const rbacApi = await RhdhRbacApi.build(apiToken);
      await deleteRoleIfExists(rbacApi, workflowUserRoleName);
    });

    test("Create role with greeting workflow read-write permissions for both users", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe", "user:default/rhdh-qe-2"];

      workflowUserRoleName = `role:default/workflowUser`;

      const workflowUserRole = {
        memberReferences: members,
        name: workflowUserRoleName,
      };

      // Workflow-specific permissions for greeting workflow
      // Note: Users can always see their own workflow instances (initiator-based access)
      // without needing orchestrator.instanceAdminView permission
      const workflowUserPolicies = [
        {
          entityReference: workflowUserRoleName,
          permission: "orchestrator.workflow.greeting",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: workflowUserRoleName,
          permission: "orchestrator.workflow.use.greeting",
          policy: "update",
          effect: "allow",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(workflowUserRole);
      const policyPostResponse =
        await rbacApi.createPolicies(workflowUserPolicies);

      // Log errors if they occur for debugging
      const roleOk = rolePostResponse.ok();
      const policyOk = policyPostResponse.ok();

      // Log status codes for debugging purposes.
      // Playwright APIResponse exposes status as a method: status()
      const roleStatus = rolePostResponse.status();
      const policyStatus = policyPostResponse.status();

      console.log(`Role creation status: ${roleStatus}`);
      console.log(`Policy creation status: ${policyStatus}`);

      // eslint-disable-next-line playwright/no-conditional-in-test
      if (!roleOk) {
        const errorBody = await rolePostResponse.text();
        console.log(`Role creation error body: ${errorBody}`);
      }
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (!policyOk) {
        const errorBody = await policyPostResponse.text();
        console.log(`Policy creation error body: ${errorBody}`);
      }

      expect(roleOk).toBeTruthy();
      expect(policyOk).toBeTruthy();
    });

    test("Verify workflow user role exists via API with both users", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const workflowRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === workflowUserRoleName,
      );
      expect(workflowRole).toBeDefined();
      expect(workflowRole?.memberReferences).toContain("user:default/rhdh-qe");
      expect(workflowRole?.memberReferences).toContain(
        "user:default/rhdh-qe-2",
      );

      const roleNameForApi = workflowUserRoleName.replace("role:", "");
      const policiesResponse = await rbacApi.getPoliciesByRole(roleNameForApi);
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(2);

      const allowReadPolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.greeting" &&
          policy.policy === "read",
      );
      const allowUpdatePolicy = policies.find(
        (policy: { permission: string; policy: string; effect: string }) =>
          policy.permission === "orchestrator.workflow.use.greeting" &&
          policy.policy === "update",
      );

      expect(allowReadPolicy).toBeDefined();
      expect(allowUpdatePolicy).toBeDefined();
      expect(allowReadPolicy.effect).toBe("allow");
      expect(allowUpdatePolicy.effect).toBe("allow");
    });

    test("rhdh-qe user runs greeting workflow and captures instance ID", async () => {
      await page.reload();
      await uiHelper.goToPageUrl("/orchestrator");
      await uiHelper.verifyHeading("Workflows");

      // Navigate to Greeting workflow
      const greetingWorkflowLink = page.getByRole("link", {
        name: "Greeting workflow",
      });
      await expect(greetingWorkflowLink).toBeVisible();
      await greetingWorkflowLink.click();
      await expect(
        page.getByRole("heading", { name: "Greeting workflow" }),
      ).toBeVisible();

      // Click Run button
      const runButton = page.getByRole("button", { name: "Run" });
      await expect(runButton).toBeVisible();
      await expect(runButton).toBeEnabled();
      await runButton.click();

      // On "Run workflow" page - click Next
      const nextButton = page.getByRole("button", { name: "Next" });
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      // Click Run to execute the workflow
      const finalRunButton = page.getByRole("button", { name: "Run" });
      await expect(finalRunButton).toBeVisible();
      await finalRunButton.click();

      // Wait for workflow to complete and capture instance ID from URL
      await page.waitForURL(/\/orchestrator\/instances\/[a-f0-9-]+/);
      const url = page.url();
      const match = url.match(/\/orchestrator\/instances\/([a-f0-9-]+)/);
      expect(match).not.toBeNull();
      workflowInstanceId = match![1];
      console.log(`Captured workflow instance ID: ${workflowInstanceId}`);

      // Verify workflow completed successfully
      await expect(page.getByText(/Run completed at/i)).toBeVisible({
        timeout: 30000,
      });
    });

    test("rhdh-qe user can see their workflow instance", async () => {
      // Navigate directly to the instance details page to verify access
      // This is more reliable than navigating through the "all runs" tab
      await uiHelper.goToPageUrl(
        `/orchestrator/instances/${workflowInstanceId}`,
      );

      // Verify the instance details page loads correctly
      // The page should show instance details with workflow status
      await page.waitForLoadState("load");

      // Verify we can see the instance - check for key elements
      // The page should show "Completed" status and have details/results tabs
      await expect(page.getByText("Completed", { exact: true })).toBeVisible({
        timeout: 30000,
      });

      // Verify the instance ID appears in the URL or page
      console.log(
        `Verified access to workflow instance: ${workflowInstanceId}`,
      );
    });

    test("rhdh-qe-2 user cannot access rhdh-qe's workflow instance", async () => {
      // Clear browser storage and navigate to a fresh state
      await page.context().clearCookies();
      await page.goto("/");
      await page.waitForLoadState("load");

      // Now login as rhdh-qe-2
      try {
        await common.loginAsKeycloakUser(
          process.env.GH_USER2_ID,
          process.env.GH_USER2_PASS,
        );
        console.log("Successfully logged in as rhdh-qe-2");
      } catch (error) {
        console.log("Login failed, user might already be logged in:", error);
        // Continue with the test - user might already be logged in
      }

      // Try to directly access rhdh-qe's workflow instance
      // This should be denied due to instance isolation
      await uiHelper.goToPageUrl(
        `/orchestrator/instances/${workflowInstanceId}`,
      );
      await page.waitForLoadState("load");

      // rhdh-qe-2 should NOT be able to access rhdh-qe's workflow instance
      // Expect either an error, a 404, or a redirect away from the instance page
      const pageContent = await page.textContent("body");
      console.log(
        `Page content when accessing instance: ${pageContent?.substring(0, 500)}`,
      );

      // Verify that rhdh-qe-2 cannot see the instance details
      // The page should show an error or redirect to a different page
      const hasAccessDenied =
        pageContent?.includes("not found") ||
        pageContent?.includes("Not Found") ||
        pageContent?.includes("denied") ||
        pageContent?.includes("unauthorized") ||
        pageContent?.includes("Unauthorized") ||
        !pageContent?.includes("Completed");

      expect(hasAccessDenied).toBe(true);
    });

    test("Clean up any existing workflowAdmin role", async () => {
      workflowAdminRoleName = `role:default/workflowAdmin`;
      const rbacApi = await RhdhRbacApi.build(apiToken);
      await deleteRoleIfExists(rbacApi, workflowAdminRoleName);
    });

    test("Create workflow admin role and update rhdh-qe-2 membership", async () => {
      // Set role names in case running individual tests
      workflowUserRoleName = `role:default/workflowUser`;
      workflowAdminRoleName = `role:default/workflowAdmin`;

      // Clear browser storage and navigate to a fresh state
      await page.context().clearCookies();
      await page.goto("/");
      await page.waitForLoadState("load");

      // Now login as rhdh-qe to perform role/policy operations
      try {
        await common.loginAsKeycloakUser();
        console.log("Successfully logged in as rhdh-qe");
      } catch (error) {
        console.log("Login failed:", error);
        throw error; // Re-throw to fail the test if login doesn't work
      }
      apiToken = await RhdhAuthApiHack.getToken(page);

      const rbacApi = await RhdhRbacApi.build(apiToken);

      // First, create the workflowUser role if it doesn't exist (for individual test runs)
      const members = ["user:default/rhdh-qe", "user:default/rhdh-qe-2"];
      const workflowUserRole = {
        memberReferences: members,
        name: workflowUserRoleName,
      };

      const workflowUserPolicies = [
        {
          entityReference: workflowUserRoleName,
          permission: "orchestrator.workflow.greeting",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: workflowUserRoleName,
          permission: "orchestrator.workflow.use.greeting",
          policy: "update",
          effect: "allow",
        },
      ];

      // Try to create the workflowUser role (will fail if it already exists, which is fine)
      try {
        await rbacApi.createRoles(workflowUserRole);
        await rbacApi.createPolicies(workflowUserPolicies);
        console.log(
          "Created workflowUser role and policies for individual test run",
        );
      } catch (error) {
        console.log(
          "workflowUser role already exists or creation failed (expected for serial runs):",
          error,
        );
      }

      // Create workflowAdmin role with rhdh-qe-2 as member

      const workflowAdminRole = {
        memberReferences: ["user:default/rhdh-qe-2"],
        name: workflowAdminRoleName,
      };

      // Admin policies: global workflow access + instanceAdminView to see ALL instances
      const workflowAdminPolicies = [
        {
          entityReference: workflowAdminRoleName,
          permission: "orchestrator.workflow",
          policy: "read",
          effect: "allow",
        },
        {
          entityReference: workflowAdminRoleName,
          permission: "orchestrator.workflow.use",
          policy: "update",
          effect: "allow",
        },
        {
          entityReference: workflowAdminRoleName,
          permission: "orchestrator.instanceAdminView",
          policy: "read",
          effect: "allow",
        },
      ];

      const rolePostResponse = await rbacApi.createRoles(workflowAdminRole);
      const policyPostResponse = await rbacApi.createPolicies(
        workflowAdminPolicies,
      );

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();

      // Wait a moment for the role changes to take effect
      await page.waitForTimeout(2000);

      // Update workflowUser role to remove rhdh-qe-2
      const oldWorkflowUserRole = {
        memberReferences: ["user:default/rhdh-qe", "user:default/rhdh-qe-2"],
        name: workflowUserRoleName,
      };
      const updatedWorkflowUserRole = {
        memberReferences: ["user:default/rhdh-qe"],
        name: workflowUserRoleName,
      };

      const roleNameForApi = workflowUserRoleName.replace("role:", "");
      console.log(`Updating role: ${roleNameForApi}`);
      const roleUpdateResponse = await rbacApi.updateRole(
        roleNameForApi,
        oldWorkflowUserRole,
        updatedWorkflowUserRole,
      );

      // Log errors if they occur for debugging
      const roleUpdateOk = roleUpdateResponse.ok();

      // Log errors for debugging purposes
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (!roleUpdateOk) {
        console.log(
          `Role update failed with status: ${roleUpdateResponse.status()}`,
        );
        const errorBody = await roleUpdateResponse.text();
        console.log(`Role update error body: ${errorBody}`);
      }

      expect(roleUpdateOk).toBeTruthy();
    });

    test("Verify workflow admin role exists and rhdh-qe-2 is removed from workflowUser", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      // Verify workflowAdmin role
      const rolesResponse = await rbacApi.getRoles();
      expect(rolesResponse.ok()).toBeTruthy();

      const roles = await rolesResponse.json();
      const adminRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === workflowAdminRoleName,
      );
      expect(adminRole).toBeDefined();
      expect(adminRole?.memberReferences).toContain("user:default/rhdh-qe-2");

      const adminRoleNameForApi = workflowAdminRoleName.replace("role:", "");
      const policiesResponse =
        await rbacApi.getPoliciesByRole(adminRoleNameForApi);
      expect(policiesResponse.ok()).toBeTruthy();

      const policies = await policiesResponse.json();
      expect(policies).toHaveLength(3);

      // Verify workflowUser role no longer has rhdh-qe-2
      const workflowUserRole = roles.find(
        (role: { name: string; memberReferences: string[] }) =>
          role.name === workflowUserRoleName,
      );
      expect(workflowUserRole).toBeDefined();
      expect(workflowUserRole?.memberReferences).toContain(
        "user:default/rhdh-qe",
      );
      expect(workflowUserRole?.memberReferences).not.toContain(
        "user:default/rhdh-qe-2",
      );
    });

    test("rhdh-qe-2 with instanceAdminView CAN access rhdh-qe's workflow instance", async () => {
      // Clear browser storage and navigate to a fresh state
      await page.context().clearCookies();
      await page.goto("/");
      await page.waitForLoadState("load");

      // Login as rhdh-qe-2 who now has instanceAdminView permission
      try {
        await common.loginAsKeycloakUser(
          process.env.GH_USER2_ID,
          process.env.GH_USER2_PASS,
        );
        console.log(
          "Successfully logged in as rhdh-qe-2 with admin permissions",
        );
      } catch (error) {
        console.log("Login failed:", error);
        throw error;
      }

      // Navigate to rhdh-qe's workflow instance - should now be accessible
      await uiHelper.goToPageUrl(
        `/orchestrator/instances/${workflowInstanceId}`,
      );
      await page.waitForLoadState("load");

      // With instanceAdminView, rhdh-qe-2 should be able to see the instance details
      // Verify the instance details are visible (not an error page)
      await expect(page.getByText("Completed", { exact: true })).toBeVisible({
        timeout: 30000,
      });

      console.log(
        `Admin user rhdh-qe-2 successfully accessed workflow instance: ${workflowInstanceId}`,
      );
    });

    test.afterAll(async () => {
      try {
        // Navigate to home page to ensure we're in a good state
        await page.goto("/");

        // Clear cookies to ensure clean state
        await page.context().clearCookies();

        // Login as rhdh-qe to perform cleanup
        try {
          await common.loginAsKeycloakUser();
          apiToken = await RhdhAuthApiHack.getToken(page);
        } catch (error) {
          console.log("Login failed during cleanup, continuing:", error);
          return; // Skip cleanup if we can't login
        }

        const rbacApi = await RhdhRbacApi.build(apiToken);

        // Delete workflowUser role and policies (if they exist)
        if (workflowUserRoleName) {
          try {
            const workflowUserRoleNameForApi = workflowUserRoleName.replace(
              "role:",
              "",
            );
            const workflowUserPoliciesResponse =
              await rbacApi.getPoliciesByRole(workflowUserRoleNameForApi);

            if (workflowUserPoliciesResponse.ok()) {
              const workflowUserPolicies =
                await Response.removeMetadataFromResponse(
                  workflowUserPoliciesResponse,
                );

              await rbacApi.deletePolicy(
                workflowUserRoleNameForApi,
                workflowUserPolicies as Policy[],
              );

              await rbacApi.deleteRole(workflowUserRoleNameForApi);

              console.log(
                `Cleaned up workflowUser role: ${workflowUserRoleNameForApi}`,
              );
            }
          } catch (error) {
            console.log(`Error cleaning up workflowUser role: ${error}`);
          }
        }

        // Delete workflowAdmin role and policies (if they exist)
        if (workflowAdminRoleName) {
          try {
            const workflowAdminRoleNameForApi = workflowAdminRoleName.replace(
              "role:",
              "",
            );
            const workflowAdminPoliciesResponse =
              await rbacApi.getPoliciesByRole(workflowAdminRoleNameForApi);

            if (workflowAdminPoliciesResponse.ok()) {
              const workflowAdminPolicies =
                await Response.removeMetadataFromResponse(
                  workflowAdminPoliciesResponse,
                );

              await rbacApi.deletePolicy(
                workflowAdminRoleNameForApi,
                workflowAdminPolicies as Policy[],
              );

              await rbacApi.deleteRole(workflowAdminRoleNameForApi);

              console.log(
                `Cleaned up workflowAdmin role: ${workflowAdminRoleNameForApi}`,
              );
            }
          } catch (error) {
            console.log(`Error cleaning up workflowAdmin role: ${error}`);
          }
        }
      } catch (error) {
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });
});
