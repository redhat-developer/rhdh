import { Policy, Role } from "../support/api/rbac-api-structures";
import { EXPECTED_POLICIES } from "./rbac-constants-policies";
import { EXPECTED_ROLES } from "./rbac-constants-roles";

/**
 * Common test user entity references used across RBAC tests.
 */
export const TEST_USER = "user:default/rhdh-qe";
export const TEST_USER_2 = "user:default/rhdh-qe-2";

export function getExpectedRoles(): Role[] {
  return EXPECTED_ROLES;
}

export function getExpectedPolicies(): Policy[] {
  return EXPECTED_POLICIES;
}
