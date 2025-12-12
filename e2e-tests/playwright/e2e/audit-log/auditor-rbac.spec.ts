import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../utils/common";
import {
  RBAC_API,
  ROLE_NAME,
  USER_ENTITY_REF,
  PLUGIN_ACTOR_ID,
  ROLE_PAYLOAD,
  POLICY_DATA,
  POLICY_PAYLOAD,
  validateRbacLogEvent,
  buildNotAllowedError,
  httpMethod,
} from "./rbac-test-utils";
import RhdhRbacApi from "../../support/api/rbac-api";
let common: Common;
let rbacApi: RhdhRbacApi;

/* ======================================================================== */
/*  RBAC AUDIT‑LOG PLAYWRIGHT SPEC                                         */
/* ======================================================================== */

test.describe("Auditor check for RBAC Plugin", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    test.info().annotations.push({
      type: "component",
      description: "audit-log",
    });

    await (await import("./log-utils")).LogUtils.loginToOpenShift();
    const page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    await common.loginAsKeycloakUser();
    rbacApi = await RhdhRbacApi.buildRbacApi(page);
  });

  /* --------------------------------------------------------------------- */
  /*  ROLE READ                                                            */
  /* --------------------------------------------------------------------- */
  const roleRead = [
    {
      name: "all",
      call: () => rbacApi.getRoles(),
      url: RBAC_API.role.collection,
      meta: { queryType: "all", source: "rest" },
    },
    {
      name: "by-role",
      call: () => rbacApi.getRole(ROLE_NAME),
      url: RBAC_API.role.item(ROLE_NAME),
      meta: { queryType: "by-role", source: "rest" },
    },
  ];

  for (const s of roleRead) {
    test(`role-read → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent(
        "role-read",
        USER_ENTITY_REF,
        { method: "GET", url: s.url },
        s.meta,
      );
    });
  }

  /* --------------------------------------------------------------------- */
  /*  ROLE WRITE                                                           */
  /* --------------------------------------------------------------------- */
  const roleWrite = [
    {
      name: "create",
      call: () => rbacApi.createRoles(ROLE_PAYLOAD),
      url: RBAC_API.role.collection,
      action: "create" as const,
    },
    {
      name: "update",
      call: () => rbacApi.updateRole(ROLE_NAME, ROLE_PAYLOAD, ROLE_PAYLOAD),
      url: RBAC_API.role.item(ROLE_NAME),
      action: "update" as const,
    },
    {
      name: "delete",
      call: () => rbacApi.deleteRole(ROLE_NAME),
      url: RBAC_API.role.item(ROLE_NAME),
      action: "delete" as const,
    },
  ];

  for (const s of roleWrite) {
    test(`role-write → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent(
        "role-write",
        USER_ENTITY_REF,
        { method: httpMethod(s.action), url: s.url },
        { actionType: s.action, source: "rest" },
        buildNotAllowedError(s.action, "role"),
        "failed",
      );
    });
  }

  /* --------------------------------------------------------------------- */
  /*  POLICY READ                                                          */
  /* --------------------------------------------------------------------- */
  const policyRead = [
    {
      name: "all",
      call: () => rbacApi.getPolicies(),
      url: RBAC_API.policy.collection,
      meta: { queryType: "all", source: "rest" },
    },
    {
      name: "by-role",
      call: () => rbacApi.getPoliciesByRole(ROLE_NAME),
      url: RBAC_API.policy.item(ROLE_NAME),
      meta: {
        entityRef: `role:${ROLE_NAME}`,
        queryType: "by-role",
        source: "rest",
      },
    },
    {
      name: "by-query",
      call: () =>
        rbacApi.getPoliciesByQuery({
          entityRef: USER_ENTITY_REF,
          permission: POLICY_DATA.permission,
          policy: POLICY_DATA.policy,
          effect: POLICY_DATA.effect,
        }),
      url: `${RBAC_API.policy.collection}?entityRef=${encodeURIComponent(USER_ENTITY_REF)}&permission=${POLICY_DATA.permission}&policy=${POLICY_DATA.policy}&effect=${POLICY_DATA.effect}`,
      meta: {
        query: { ...POLICY_DATA, entityRef: USER_ENTITY_REF },
        queryType: "by-query",
        source: "rest",
      },
    },
  ];

  for (const s of policyRead) {
    test(`policy-read → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent(
        "policy-read",
        USER_ENTITY_REF,
        { method: "GET", url: s.url },
        s.meta,
      );
    });
  }

  /* --------------------------------------------------------------------- */
  /*  POLICY WRITE                                                         */
  /* --------------------------------------------------------------------- */
  const policyWrite = [
    {
      name: "create",
      call: () => rbacApi.createPolicies([POLICY_PAYLOAD]),
      url: RBAC_API.policy.collection,
      action: "create" as const,
    },
    {
      name: "update",
      call: () =>
        rbacApi.updatePolicy(
          ROLE_NAME,
          [POLICY_DATA],
          [{ ...POLICY_DATA, effect: "deny" }],
        ),
      url: RBAC_API.policy.item(ROLE_NAME),
      action: "update" as const,
    },
    {
      name: "delete",
      call: () => rbacApi.deletePolicy(ROLE_NAME, [POLICY_PAYLOAD]),
      url: RBAC_API.policy.item(ROLE_NAME),
      action: "delete" as const,
    },
  ];

  for (const s of policyWrite) {
    test(`policy-write → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent(
        "policy-write",
        USER_ENTITY_REF,
        { method: httpMethod(s.action), url: s.url },
        { actionType: s.action, source: "rest" },
        buildNotAllowedError(
          s.action,
          "policy",
          `${ROLE_NAME},policy-entity,read,allow`,
        ),
        "failed",
      );
    });
  }

  /* --------------------------------------------------------------------- */
  /*  CONDITION READ                                                       */
  /* --------------------------------------------------------------------- */
  const conditionRead = [
    {
      name: "all",
      call: () => rbacApi.getConditions(),
      url: RBAC_API.condition.collection,
      meta: { queryType: "all", source: "rest" },
    },
    {
      name: "by-query",
      call: () =>
        rbacApi.getConditionByQuery({
          roleEntityRef: "role:default/test2-role",
          pluginId: "catalog",
          resourceType: "catalog-entity",
          actions: "read",
        }),
      url: `${RBAC_API.condition.collection}?roleEntityRef=role%3Adefault%2Ftest2-role&pluginId=catalog&resourceType=catalog-entity&actions=read`,
      meta: {
        query: {
          actions: "read",
          pluginId: "catalog",
          resourceType: "catalog-entity",
          roleEntityRef: "role:default/test2-role",
        },
        queryType: "by-query",
        source: "rest",
      },
    },
    {
      name: "by-id",
      call: () => rbacApi.getConditionById(1),
      url: RBAC_API.condition.item(1),
      meta: { id: "1", queryType: "by-id", source: "rest" },
    },
  ];

  for (const s of conditionRead) {
    test(`condition-read → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent(
        "condition-read",
        USER_ENTITY_REF,
        { method: "GET", url: s.url },
        s.meta,
      );
    });
  }

  /* --------------------------------------------------------------------- */
  /*  PERMISSION EVALUATION                                                */
  /* --------------------------------------------------------------------- */
  test("permission-evaluation", async () => {
    await rbacApi.getRoles();
    await validateRbacLogEvent(
      "permission-evaluation",
      PLUGIN_ACTOR_ID,
      undefined,
      {
        action: "read",
        permissionName: "policy.entity.read",
        resourceType: "policy-entity",
        result: "ALLOW",
        userEntityRef: USER_ENTITY_REF,
      },
      undefined,
      "succeeded",
      ["policy.entity.read", USER_ENTITY_REF],
    );
  });
});
