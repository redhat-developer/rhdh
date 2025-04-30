import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../utils/common";
import { LogUtils } from "./log-utils";
import { EventStatus, LogRequest } from "./logs";
import { type JsonObject } from "@backstage/types";
import { RhdhAuthApiHack } from "../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../support/api/rbac-api";

const userEntityRef = "user:default/rhdh-qe";
const pluginActorId = "plugin:permission";
const roleName = "default/rbac_admin";
const baseRoleUrl = "/api/permission/roles/role/" + roleName;
const basePolicyUrl = "/api/permission/policies/role/" + roleName;
const baseConditionUrl = "/api/permission/roles/conditions";
const errorTemplate = (action: string, type: 'role' | 'policy') =>
  `NotAllowedError: Unable to ${action} ${type} ${type === 'role' ? `role:${roleName}` : `${roleName},policy-entity,read,allow`}: source does not match originating role role:${roleName}, consider making changes to the 'CONFIGURATION'`;

let common: Common;
let apiToken: string;
let rbacApi: RhdhRbacApi;

async function validateRbacLogEvent(
  eventId: string,
  actorId: string,
  request?: LogRequest,
  meta?: JsonObject,
  error?: string,
  status: EventStatus = "succeeded",
  filterWords: string[] = []
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
    filterWords,
    process.env.NAME_SPACE_RBAC,
  );
}

test.describe("Auditor check for RBAC Plugin", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    await LogUtils.loginToOpenShift();
    const page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    await common.loginAsKeycloakUser();
    apiToken = await RhdhAuthApiHack.getToken(page);
    rbacApi = await RhdhRbacApi.build(apiToken);
  });

  const roleReadTests = [
    {
      name: "queryType 'all'",
      call: () => rbacApi.getRoles(),
      logMeta: { queryType: "all", source: "rest" },
      url: "/api/permission/roles"
    },
    {
      name: "queryType 'by-role'",
      call: () => rbacApi.getRole(roleName),
      logMeta: { queryType: "by-role", source: "rest" },
      url: baseRoleUrl
    },
  ];

  for (const { name, call, logMeta, url } of roleReadTests) {
    test(`Validate 'role-read' ${name}`, async () => {
      await call();
      await validateRbacLogEvent("role-read", userEntityRef, { method: "GET", url }, logMeta);
    });
  }

  const roleWriteActions = ["create", "update", "delete"];
  const rolePayload = {
    memberReferences: [userEntityRef],
    name: "role:" + roleName,
  };

  for (const action of roleWriteActions) {
    test(`Validate 'role-write' actionType '${action}'`, async () => {
      const url = action === "create" ? "/api/permission/roles" : baseRoleUrl;
      if (action === "create") await rbacApi.createRoles(rolePayload);
      if (action === "update") await rbacApi.updateRole(roleName, rolePayload, rolePayload);
      if (action === "delete") await rbacApi.deleteRole(roleName);
      await validateRbacLogEvent(
        "role-write",
        userEntityRef,
        { method: action === "create" ? "POST" : action === "update" ? "PUT" : "DELETE", url },
        { actionType: action, source: "rest" },
        errorTemplate(action, "role"),
        "failed"
      );
    });
  }

  const policyReadTests = [
    {
      name: "queryType 'all'",
      call: () => rbacApi.getPolicies(),
      logMeta: { queryType: "all", source: "rest" },
      url: "/api/permission/policies"
    },
    {
      name: "queryType 'by-role'",
      call: () => rbacApi.getPoliciesByRole(roleName),
      logMeta: { entityRef: `role:${roleName}`, queryType: "by-role", source: "rest" },
      url: basePolicyUrl
    },
    {
      name: "queryType 'by-query'",
      call: () => rbacApi.getPoliciesByQuery({
        entityRef: userEntityRef,
        permission: "policy-entity",
        policy: "read",
        effect: "allow",
      }),
      logMeta: {
        query: {
          effect: "allow",
          entityRef: userEntityRef,
          permission: "policy-entity",
          policy: "read",
        },
        queryType: "by-query",
        source: "rest"
      },
      url: `/api/permission/policies?entityRef=${encodeURIComponent(userEntityRef)}&permission=policy-entity&policy=read&effect=allow`
    }
  ];

  for (const { name, call, logMeta, url } of policyReadTests) {
    test(`Validate 'policy-read' ${name}`, async () => {
      await call();
      await validateRbacLogEvent("policy-read", userEntityRef, { method: "GET", url }, logMeta);
    });
  }

  const policyWriteActions = ["create", "update", "delete"];
  const policyData = {
    permission: "policy-entity",
    policy: "read",
    effect: "allow"
  };
  const policyPayload = {
    entityReference: `role:${roleName}`,
    ...policyData,
  };

  for (const action of policyWriteActions) {
    test(`Validate 'policy-write' actionType '${action}'`, async () => {
      const url = action === "create" ? "/api/permission/policies" : basePolicyUrl;
      if (action === "create") await rbacApi.createPolicies([policyPayload]);
      if (action === "update") await rbacApi.updatePolicy(roleName, [policyData], [{ ...policyData, effect: "deny" }]);
      if (action === "delete") await rbacApi.deletePolicy(roleName, [policyPayload]);
      await validateRbacLogEvent(
        "policy-write",
        userEntityRef,
        { method: action === "create" ? "POST" : action === "update" ? "PUT" : "DELETE", url },
        { actionType: action, source: "rest" },
        errorTemplate(action, "policy"),
        "failed"
      );
    });
  }

  const conditionReadTests = [
    {
      name: "queryType 'all'",
      call: () => rbacApi.getConditions(),
      url: baseConditionUrl,
      meta: { queryType: "all", source: "rest" }
    },
    {
      name: "queryType 'by-query'",
      call: () => rbacApi.getConditionByQuery({
        roleEntityRef: "role:default/test2-role",
        pluginId: "catalog",
        resourceType: "catalog-entity",
        actions: "read",
      }),
      url: `${baseConditionUrl}?roleEntityRef=role%3Adefault%2Ftest2-role&pluginId=catalog&resourceType=catalog-entity&actions=read`,
      meta: {
        query: {
          actions: "read",
          pluginId: "catalog",
          resourceType: "catalog-entity",
          roleEntityRef: "role:default/test2-role",
        },
        queryType: "by-query",
        source: "rest"
      }
    },
    {
      name: "queryType 'by-id'",
      call: () => rbacApi.getConditionById(1),
      url: `${baseConditionUrl}/1`,
      meta: { id: "1", queryType: "by-id", source: "rest" }
    },
  ];

  for (const { name, call, url, meta } of conditionReadTests) {
    test(`Validate 'condition-read' ${name}`, async () => {
      await call();
      await validateRbacLogEvent("condition-read", userEntityRef, { method: "GET", url }, meta);
    });
  }

  test("Logs should have correct structure for 'permission-evaluation' event", async () => {
    await rbacApi.getRoles();
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
      undefined,
      "succeeded",
      ["policy.entity.read", userEntityRef],
    );
  });
});
