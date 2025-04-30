import { test } from "@playwright/test";
import { Common, setupBrowser } from "../../utils/common";
import {
  API,
  ROLE_NAME,
  USER_ENTITY_REF,
  PLUGIN_ACTOR_ID,
  ROLE_PAYLOAD,
  POLICY_DATA,
  POLICY_PAYLOAD,
  validateRbacLogEvent,
  rbacError,
  methodFor,
  buildRbacApi,
} from "./rbac-test-utils";
import { EventStatus } from "./logs";
import RhdhRbacApi from "../../support/api/rbac-api";

let common: Common;
let rbacApi: RhdhRbacApi;

/**
 * RBAC audit‑log end‑to‑end tests
 */

test.describe("Auditor check for RBAC Plugin", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    // Login in cluster and backstage UI
    await (await import("./log-utils")).LogUtils.loginToOpenShift();
    const page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    await common.loginAsKeycloakUser();
    rbacApi = await buildRbacApi(page);
  });

  /* ----------------------------------------------------------------------- */
  /*  ROLE READ                                                              */
  /* ----------------------------------------------------------------------- */
  const roleReadScenarios = [
    {
      name: "all",
      call: () => rbacApi.getRoles(),
      url: API.role.collection,
      meta: { queryType: "all", source: "rest" },
    },
    {
      name: "by‑role",
      call: () => rbacApi.getRole(ROLE_NAME),
      url: API.role.item(ROLE_NAME),
      meta: { queryType: "by-role", source: "rest" },
    },
  ];

  for (const s of roleReadScenarios) {
    test(`role-read → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent("role-read", USER_ENTITY_REF, { method: "GET", url: s.url }, s.meta);
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  ROLE WRITE                                                             */
  /* ----------------------------------------------------------------------- */
  (['create', 'update', 'delete'] as const).forEach(action => {
    test(`role-write → ${action}`, async () => {
      const url = action === 'create' ? API.role.collection : API.role.item(ROLE_NAME);
      if (action === 'create') await rbacApi.createRoles(ROLE_PAYLOAD);
      if (action === 'update') await rbacApi.updateRole(ROLE_NAME, ROLE_PAYLOAD, ROLE_PAYLOAD);
      if (action === 'delete') await rbacApi.deleteRole(ROLE_NAME);
      await validateRbacLogEvent(
        'role-write',
        USER_ENTITY_REF,
        { method: methodFor(action), url },
        { actionType: action, source: 'rest' },
        rbacError(action, `role:${ROLE_NAME}`),
        'failed' as EventStatus,
      );
    });
  });

  /* ----------------------------------------------------------------------- */
  /*  POLICY READ                                                            */
  /* ----------------------------------------------------------------------- */
  const policyReadScenarios = [
    {
      name: 'all',
      call: () => rbacApi.getPolicies(),
      url: API.policy.collection,
      meta: { queryType: 'all', source: 'rest' },
    },
    {
      name: 'by‑role',
      call: () => rbacApi.getPoliciesByRole(ROLE_NAME),
      url: API.policy.item(ROLE_NAME),
      meta: { entityRef: `role:${ROLE_PAYLOAD}`, queryType: 'by-role', source: 'rest' },
    },
    {
      name: 'by‑query',
      call: () => rbacApi.getPoliciesByQuery({
        entityRef: USER_ENTITY_REF,
        permission: POLICY_DATA.permission,
        policy: POLICY_DATA.policy,
        effect: POLICY_DATA.effect,
      }),
      url: `${API.policy.collection}?entityRef=${encodeURIComponent(USER_ENTITY_REF)}&permission=${POLICY_DATA.permission}&policy=${POLICY_DATA.policy}&effect=${POLICY_DATA.effect}`,
      meta: {
        query: { ...POLICY_DATA, entityRef: USER_ENTITY_REF },
        queryType: 'by-query',
        source: 'rest',
      },
    },
  ];

  for (const s of policyReadScenarios) {
    test(`policy-read → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent('policy-read', USER_ENTITY_REF, { method: 'GET', url: s.url }, s.meta);
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  POLICY WRITE                                                           */
  /* ----------------------------------------------------------------------- */
  (['create', 'update', 'delete'] as const).forEach(action => {
    test(`policy-write → ${action}`, async () => {
      const url = action === 'create' ? API.policy.collection : API.policy.item(ROLE_NAME);
      if (action === 'create') await rbacApi.createPolicies([POLICY_PAYLOAD]);
      if (action === 'update') await rbacApi.updatePolicy(ROLE_NAME, [POLICY_DATA], [{ ...POLICY_DATA, effect: 'deny' }]);
      if (action === 'delete') await rbacApi.deletePolicy(ROLE_NAME, [POLICY_PAYLOAD]);
      await validateRbacLogEvent(
        'policy-write',
        USER_ENTITY_REF,
        { method: methodFor(action), url },
        { actionType: action, source: 'rest' },
        rbacError(action, `${ROLE_NAME},policy-entity,read,allow`),
        'failed' as EventStatus,
      );
    });
  });

  /* ----------------------------------------------------------------------- */
  /*  CONDITION READ                                                         */
  /* ----------------------------------------------------------------------- */
  const conditionReadScenarios = [
    {
      name: 'all',
      call: () => rbacApi.getConditions(),
      url: API.condition.collection,
      meta: { queryType: 'all', source: 'rest' },
    },
    {
      name: 'by‑query',
      call: () => rbacApi.getConditionByQuery({
        roleEntityRef: 'role:default/test2-role',
        pluginId: 'catalog',
        resourceType: 'catalog-entity',
        actions: 'read',
      }),
      url: `${API.condition.collection}?roleEntityRef=role%3Adefault%2Ftest2-role&pluginId=catalog&resourceType=catalog-entity&actions=read`,
      meta: {
        query: {
          actions: 'read',
          pluginId: 'catalog',
          resourceType: 'catalog-entity',
          roleEntityRef: 'role:default/test2-role',
        },
        queryType: 'by-query',
        source: 'rest',
      },
    },
    {
      name: 'by‑id',
      call: () => rbacApi.getConditionById(1),
      url: API.condition.item(1),
      meta: { id: '1', queryType: 'by-id', source: 'rest' },
    },
  ];

  for (const s of conditionReadScenarios) {
    test(`condition-read → ${s.name}`, async () => {
      await s.call();
      await validateRbacLogEvent('condition-read', USER_ENTITY_REF, { method: 'GET', url: s.url }, s.meta);
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  PERMISSION EVALUATION                                                  */
  /* ----------------------------------------------------------------------- */
  test('permission-evaluation', async () => {
    await rbacApi.getRoles();
    await validateRbacLogEvent(
      'permission-evaluation',
      PLUGIN_ACTOR_ID,
      undefined,
      {
        action: 'read',
        permissionName: 'policy.entity.read',
        resourceType: 'policy-entity',
        result: 'ALLOW',
        USER_ENTITY_REF,
      },
      undefined,
      'succeeded',
      ['policy.entity.read', USER_ENTITY_REF],
    );
  });
});
