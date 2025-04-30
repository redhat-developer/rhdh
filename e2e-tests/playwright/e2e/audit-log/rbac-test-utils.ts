/*
 * Shared utilities and fixtures for RBAC audit-log Playwright tests.
 */

import { type JsonObject } from "@backstage/types";
import RhdhRbacApi from "../../support/api/rbac-api";
import { LogUtils } from "./log-utils";
import { EventStatus, LogRequest } from "./logs";

/**
 * Common constants used across RBAC audit-log tests
 */
export const USER_ENTITY_REF = "user:default/rhdh-qe";
export const PLUGIN_ACTOR_ID = "plugin:permission";
export const ROLE_NAME = "default/rbac_admin";

export const API = {
  role: {
    collection: "/api/permission/roles",
    item: (name: string) => `/api/permission/roles/role/${name}`,
  },
  policy: {
    collection: "/api/permission/policies",
    item: (name: string) => `/api/permission/policies/role/${name}`,
  },
  condition: {
    collection: "/api/permission/roles/conditions",
    item: (id: number | string) => `/api/permission/roles/conditions/${id}`,
  },
};

/**
 * Generate the standard NotAllowedError message returned by RBAC backend
 */
export function rbacError(action: string, entityRef: string) {
  return `NotAllowedError: Unable to ${action} ${entityRef}: source does not match originating role role:${ROLE_NAME}, consider making changes to the 'CONFIGURATION'`;
}

/**
 * Wrapper around LogUtils.validateLogEvent, already pre‑filled for RBAC plugin.
 * Accepts only the first four params as obrigatory; the rest são opcionais.
 */
export async function validateRbacLogEvent(
  eventId: string,
  actorId: string,
  request?: LogRequest,
  meta?: JsonObject,
  error?: string,
  status: EventStatus = "succeeded",
  filterWords: string[] = [],
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

/**
 * Helper that returns the HTTP method by action name.
 */
export function methodFor(
  action: "create" | "update" | "delete" | "read",
): "GET" | "POST" | "PUT" | "DELETE" {
  switch (action) {
    case "create":
      return "POST";
    case "update":
      return "PUT";
    case "delete":
      return "DELETE";
    default:
      return "GET";
  }
}

/** Pre‑built payloads reused by multiple tests */
export const ROLE_PAYLOAD = {
  memberReferences: [USER_ENTITY_REF],
  name: `role:${ROLE_NAME}`,
};

export const POLICY_DATA = {
  permission: "policy-entity",
  policy: "read",
  effect: "allow",
};

export const POLICY_PAYLOAD = {
  entityReference: `role:${ROLE_NAME}`,
  ...POLICY_DATA,
};

/** Build the RBAC API helper once the Playwright page has an auth token */
export async function buildRbacApi(page): Promise<RhdhRbacApi> {
  const token = await (
    await import("../../support/api/rhdh-auth-api-hack")
  ).RhdhAuthApiHack.getToken(page);
  return RhdhRbacApi.build(token);
}
