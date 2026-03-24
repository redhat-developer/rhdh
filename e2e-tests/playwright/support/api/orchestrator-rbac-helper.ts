import { expect } from "@playwright/test";
import RhdhRbacApi from "./rbac-api";
import { Policy } from "./rbac-api-structures";

/**
 * Represents saved RBAC policies for a role that can be restored later.
 */
export interface SavedRolePolicy {
  roleName: string;
  policies: Policy[];
}

/**
 * Helper class for managing orchestrator RBAC policies during tests.
 *
 * This is needed because generic orchestrator.workflow permissions override
 * specific workflow deny policies (per RHDH documentation). Tests that need
 * to verify individual workflow denials must first remove any generic
 * orchestrator.workflow permissions.
 */
export class OrchestratorRbacHelper {
  private savedGenericPolicies: SavedRolePolicy[] = [];

  /**
   * Removes any generic orchestrator.workflow permissions for the specified user.
   * Saves the removed policies so they can be restored later.
   *
   * @param rbacApi - The RBAC API instance
   * @param userEntityRef - The user entity reference (e.g., "user:default/rhdh-qe")
   * @returns The saved policies that were removed
   */
  async removeGenericOrchestratorPermissions(
    rbacApi: RhdhRbacApi,
    userEntityRef: string,
  ): Promise<SavedRolePolicy[]> {
    this.savedGenericPolicies = [];

    // Get all roles that the user is a member of
    const rolesResponse = await rbacApi.getRoles();
    expect(rolesResponse.ok()).toBeTruthy();
    const roles = await rolesResponse.json();

    const userRoles = roles.filter(
      (role: { name: string; memberReferences: string[] }) =>
        role.memberReferences?.includes(userEntityRef),
    );

    // For each role, check if it has generic orchestrator.workflow permissions
    for (const role of userRoles) {
      const roleNameForApi = role.name.replace("role:", "");
      const policiesResponse = await rbacApi.getPoliciesByRole(roleNameForApi);

      if (!policiesResponse.ok()) continue;

      const policies = await policiesResponse.json();
      const genericOrchestratorPolicies = policies.filter(
        (policy: { permission: string }) =>
          policy.permission === "orchestrator.workflow" ||
          policy.permission === "orchestrator.workflow.use",
      );

      if (genericOrchestratorPolicies.length > 0) {
        // Save these policies for restoration later
        this.savedGenericPolicies.push({
          roleName: roleNameForApi,
          policies: genericOrchestratorPolicies.map(
            (p: { permission: string; policy: string; effect: string }) => ({
              entityReference: role.name,
              permission: p.permission,
              policy: p.policy,
              effect: p.effect,
            }),
          ),
        });

        // Remove the generic policies
        const policiesToDelete = genericOrchestratorPolicies.map(
          (p: { permission: string; policy: string; effect: string }) => ({
            entityReference: role.name,
            permission: p.permission,
            policy: p.policy,
            effect: p.effect,
          }),
        );

        console.log(
          `Removing generic orchestrator policies from ${role.name}:`,
          policiesToDelete,
        );
        const deleteResponse = await rbacApi.deletePolicy(
          roleNameForApi,
          policiesToDelete,
        );
        expect(deleteResponse.ok()).toBeTruthy();
      }
    }

    console.log(
      `Saved ${this.savedGenericPolicies.length} role(s) with generic orchestrator policies for restoration`,
    );

    return this.savedGenericPolicies;
  }

  /**
   * Restores any generic orchestrator.workflow permissions that were previously removed.
   *
   * @param rbacApi - The RBAC API instance
   */
  async restoreGenericOrchestratorPermissions(
    rbacApi: RhdhRbacApi,
  ): Promise<void> {
    for (const saved of this.savedGenericPolicies) {
      console.log(
        `Restoring generic orchestrator policies to ${saved.roleName}:`,
        saved.policies,
      );
      const restoreResponse = await rbacApi.createPolicies(saved.policies);
      if (!restoreResponse.ok()) {
        console.error(
          `Failed to restore policies to ${saved.roleName}:`,
          await restoreResponse.text(),
        );
      }
    }
  }

  /**
   * Gets the saved policies (useful for debugging or verification).
   */
  getSavedPolicies(): SavedRolePolicy[] {
    return this.savedGenericPolicies;
  }
}
