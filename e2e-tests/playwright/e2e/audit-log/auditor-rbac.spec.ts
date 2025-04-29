import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../utils/common";
import { LogUtils } from "./log-utils";
import { EventStatus, LogRequest } from "./logs";
import { type JsonObject } from "@backstage/types";
import { RhdhAuthApiHack } from "../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../support/api/rbac-api";

test.describe("Auditor check for RBAC Plugin", () => {
  let common: Common;
  let apiToken: string;
  let rbacApi: RhdhRbacApi;
  const userEntityRef = "user:default/rhdh-qe";
  const pluginActorId = "plugin:permission";

  test.beforeAll(async ({ browser }, testInfo) => {
    await LogUtils.loginToOpenShift();
    const page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    await common.loginAsKeycloakUser();

    apiToken = await RhdhAuthApiHack.getToken(page);
    rbacApi = await RhdhRbacApi.build(apiToken);
  });

  /**
   * Helper function to validate log events for RBAC Plugin
   */
  async function validateRbacLogEvent(
    eventId: string,
    actorId: string,
    request?: LogRequest,
    meta?: JsonObject,
    error?: string,
    status: EventStatus = "succeeded",
  ) {
    await LogUtils.validateLogEvent(
      eventId,
      actorId,
      request,
      meta,
      error,
      status,
      "permission",
      "medium",
      process.env.NAME_SPACE_RBAC,
    );
  }

  test.describe("Logs should have correct structure for 'role-read' event", () => {
    test("Validate 'role-read' queryType 'all'", async () => {
      console.log(
        "Validate 'role-read' queryType 'all'",
        new Date().toISOString(),
      );
      await rbacApi.getRoles();

      await validateRbacLogEvent(
        "role-read",
        userEntityRef,
        { method: "GET", url: "/api/permission/roles" },
        {
          queryType: "all",
          source: "rest",
        },
      );
    });

    test("Validate 'role-read' queryType 'by-role'", async () => {
      await rbacApi.getRole("default/rbac_admin");
      await validateRbacLogEvent(
        "role-read",
        userEntityRef,
        {
          method: "GET",
          url: "/api/permission/roles/role/default/rbac_admin",
        },
        {
          queryType: "by-role",
          source: "rest",
        },
      );
    });
  });

  test.describe("Logs should have correct structure for 'role-write' event", () => {
    const error =
      "NotAllowedError: Unable to {action} role: source does not match originating role role:default/rbac_admin, consider making changes to the 'CONFIGURATION'";
    const role = {
      memberReferences: [userEntityRef],
      name: "role:default/rbac_admin",
    };

    test("Validate 'role-write' actionType 'create'", async () => {
      await rbacApi.createRoles(role);
      await validateRbacLogEvent(
        "role-write",
        userEntityRef,
        { method: "POST", url: "/api/permission/roles" },
        {
          actionType: "create",
          source: "rest",
        },
        error.replace("{action}", "add"),
        "failed",
      );
    });

    test("Validate 'role-write' actionType 'update'", async () => {
      await rbacApi.updateRole("default/rbac_admin", role, role);
      await validateRbacLogEvent(
        "role-write",
        userEntityRef,
        { method: "PUT", url: "/api/permission/roles/role/default/rbac_admin" },
        {
          actionType: "update",
          source: "rest",
        },
        error.replace("{action}", "edit"),
        "failed",
      );
    });

    test("Validate 'role-write' actionType 'delete'", async () => {
      await rbacApi.deleteRole("default/rbac_admin");
      await validateRbacLogEvent(
        "role-write",
        userEntityRef,
        {
          method: "DELETE",
          url: "/api/permission/roles/role/default/rbac_admin",
        },
        {
          actionType: "delete",
          source: "rest",
        },
        error.replace("{action}", "delete"),
        "failed",
      );
    });
  });

  test.describe("Logs should have correct structure for 'policy-read' event", () => {
    test("Validate 'policy-read' queryType 'all'", async () => {
      await rbacApi.getPolicies();
      await validateRbacLogEvent(
        "policy-read",
        userEntityRef,
        {
          method: "GET",
          url: "/api/permission/policies",
        },
        {
          queryType: "all",
          source: "rest",
        },
      );
    });

    test("Validate 'policy-read' queryType 'by-role'", async () => {
      await rbacApi.getPoliciesByRole("default/rbac_admin");
      await validateRbacLogEvent(
        "policy-read",
        userEntityRef,
        {
          method: "GET",
          url: "/api/permission/policies/role/default/rbac_admin",
        },
        {
          entityRef: "role:default/rbac_admin",
          queryType: "by-role",
          source: "rest",
        },
      );
    });

    test("Validate 'policy-read' queryType 'by-query'", async () => {
      await rbacApi.getPoliciesByQuery({
        entityRef: userEntityRef,
        permission: "policy-entity",
        policy: "read",
        effect: "allow",
      });

      await validateRbacLogEvent(
        "policy-read",
        userEntityRef,
        {
          method: "GET",
          url: "/api/permission/policies?entityRef=user%3Adefault%2Frhdh-qe&permission=policy-entity&policy=read&effect=allow",
        },
        {
          query: {
            effect: "allow",
            entityRef: userEntityRef,
            permission: "policy-entity",
            policy: "read",
          },
          queryType: "by-query",
          source: "rest",
        },
      );
    });
  });

  test.describe("Logs should have correct structure for 'policy-write' event", () => {
    const updatePolicy = {
      permission: "policy-entity",
      policy: "read",
      effect: "allow",
    };
    const policy = {
      entityReference: "role:default/rbac_admin",
      ...updatePolicy,
    };
    const error =
      "NotAllowedError: Unable to {action} policy role:default/rbac_admin,policy-entity,read,allow: source does not match originating role role:default/rbac_admin, consider making changes to the 'CONFIGURATION'";

    test("Validate 'policy-write' actionType 'create'", async () => {
      await rbacApi.createPolicies([policy]);
      await validateRbacLogEvent(
        "policy-write",
        userEntityRef,
        { method: "POST", url: "/api/permission/policies" },
        {
          actionType: "create",
          source: "rest",
        },
        error.replace("{action}", "add"),
        "failed",
      );
    });

    test("Validate 'policy-write' actionType 'update'", async () => {
      await rbacApi.updatePolicy(
        "default/rbac_admin",
        [updatePolicy],
        [{ ...updatePolicy, effect: "deny" }],
      );
      await validateRbacLogEvent(
        "policy-write",
        userEntityRef,
        {
          method: "PUT",
          url: "/api/permission/policies/role/default/rbac_admin",
        },
        {
          actionType: "update",
          source: "rest",
        },
        error.replace("{action}", "edit"),
        "failed",
      );
    });

    test("Validate 'policy-write' actionType 'delete'", async () => {
      await rbacApi.deletePolicy("default/rbac_admin", [policy]);
      await validateRbacLogEvent(
        "policy-write",
        userEntityRef,
        {
          method: "DELETE",
          url: "/api/permission/policies/role/default/rbac_admin",
        },
        {
          actionType: "delete",
          source: "rest",
        },
        error.replace("{action}", "delete"),
        "failed",
      );
    });
  });

  test.describe("Logs should have correct structure for 'condition-read' event", () => {
    test("Validate 'condition-read' queryType 'all'", async () => {
      await rbacApi.getConditions();
      await validateRbacLogEvent(
        "condition-read",
        userEntityRef,
        { method: "GET", url: "/api/permission/roles/conditions" },
        {
          queryType: "all",
          source: "rest",
        },
      );
    });

    test("Validate 'condition-read' queryType 'by-query'", async () => {
      console.log(
        "Validate 'condition-read' queryType 'by-query'",
        new Date().toISOString(),
      );
      const resp = await rbacApi.getConditionByQuery({
        roleEntityRef: "role:default/test2-role",
        pluginId: "catalog",
        resourceType: "catalog-entity",
        actions: "read",
      });
      console.log(new Date().toISOString(), await resp.text());

      await validateRbacLogEvent(
        "condition-read",
        userEntityRef,
        {
          method: "GET",
          url: "/api/permission/roles/conditions?roleEntityRef=role%3Adefault%2Ftest2-role&pluginId=catalog&resourceType=catalog-entity&actions=read",
        },
        {
          query: {
            actions: "read",
            pluginId: "catalog",
            resourceType: "catalog-entity",
            roleEntityRef: "role:default/test2-role",
          },
          queryType: "by-query",
          source: "rest",
        },
      );
    });

    test("Validate 'condition-read' queryType 'by-id'", async () => {
      await rbacApi.getConditionById(1);
      await validateRbacLogEvent(
        "condition-read",
        userEntityRef,
        { method: "GET", url: "/api/permission/roles/conditions/1" },
        {
          id: "1",
          queryType: "by-id",
          source: "rest",
        },
      );
    });
  });

  test("Logs should have correct structure for 'permission-evaluation' event", async ({
    page,
  }) => {
    await page.goto("/rbac");
    await validateRbacLogEvent(
      "permission-evaluation",
      pluginActorId,
      undefined,
      {
        action: "read",
        permissionName: "policy.entity.read",
        resourceType: "policy-entity",
        result: "ALLOW",
        userEntityRef,
      },
    );
  });
});
