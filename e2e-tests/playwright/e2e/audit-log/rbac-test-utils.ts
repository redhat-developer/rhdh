/* --------------------------------------------------------------------------
 * Shared utilities and constants for RBAC audit-log Playwright tests
 * --------------------------------------------------------------------------*/

import { type JsonObject } from "@backstage/types";
import { LogUtils } from "./log-utils";
import { EventStatus, LogRequest } from "./logs";

/* ───────────────────────────────── CONSTANTS ───────────────────────────── */
export const USER_ENTITY_REF = "user:default/rhdh-qe";
export const PLUGIN_ACTOR_ID = "plugin:permission";
export const ROLE_NAME = "default/rbac_admin";

export const RBAC_API = {
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
 * Build the expected NotAllowedError message exactly as the backend returns.
 * For role operations the backend omits the entityRef after "role:".
 * For policy operations it includes "policy role:<entityRef>".
 */
export function buildNotAllowedError(
  action: "create" | "update" | "delete",
  entityType: "role" | "policy",
  entityRef?: string,
): string {
  // Backend verbs differ from our logical action names:
  const backendVerb: Record<
    "create" | "update" | "delete",
    "add" | "edit" | "delete"
  > = {
    create: "add",
    update: "edit",
    delete: "delete",
  };

  const verb = backendVerb[action];
  if (entityType === "role") {
    return `NotAllowedError: Unable to ${verb} role: source does not match originating role role:${ROLE_NAME}, consider making changes to the 'CONFIGURATION'`;
  }
  // policy
  return `NotAllowedError: Unable to ${verb} policy role:${entityRef}: source does not match originating role role:${ROLE_NAME}, consider making changes to the 'CONFIGURATION'`;
}

/* ───────────────────────────────── PAYLOADS ────────────────────────────── */
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

/* ──────────────────────────── HTTP-METHOD HELPER ───────────────────────── */
export function httpMethod(
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

/* ──────────────────── WRAPPER para validar eventos de log ──────────────── */
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
    "permission", // plugin name
    "medium", // expected severity
    filterWords,
    process.env.NAME_SPACE_RBAC,
  );
}
