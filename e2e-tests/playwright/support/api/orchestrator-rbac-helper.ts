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
 * Represents the expected shape of a policy from the RBAC API response.
 */
interface ApiPolicy {
  permission: string;
  policy: string;
  effect: string;
  metadata?: unknown;
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
   * Validates that a policy object has the required fields.
   */
  private isValidPolicy(policy: unknown): policy is ApiPolicy {
    if (typeof policy !== "object" || policy === null) return false;
    const p = policy as Record<string, unknown>;
    return (
      typeof p.permission === "string" &&
      typeof p.policy === "string" &&
      typeof p.effect === "string"
    );
  }

  /**
   * Removes metadata from policy objects and validates their shape.
   * Similar to Response.removeMetadataFromResponse pattern used elsewhere.
   */
  private cleanAndValidatePolicies(policies: unknown[]): ApiPolicy[] {
    const validPolicies: ApiPolicy[] = [];
    for (const policy of policies) {
      if (!this.isValidPolicy(policy)) {
        console.warn(
          `Skipping invalid policy object: ${JSON.stringify(policy)}`,
        );
        continue;
      }
      validPolicies.push({
        permission: policy.permission,
        policy: policy.policy,
        effect: policy.effect,
      });
    }
    return validPolicies;
  }

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

    const rolesResponse = await rbacApi.getRoles();
    if (!rolesResponse.ok()) {
      throw new Error(`Failed to get roles: ${await rolesResponse.text()}`);
    }
    const roles = await rolesResponse.json();

    const userRoles = roles.filter(
      (role: { name: string; memberReferences: string[] }) =>
        role.memberReferences?.includes(userEntityRef),
    );

    for (const role of userRoles) {
      const roleNameForApi = role.name.replace("role:", "");
      const policiesResponse = await rbacApi.getPoliciesByRole(roleNameForApi);

      if (!policiesResponse.ok()) continue;

      const rawPolicies = await policiesResponse.json();
      if (!Array.isArray(rawPolicies)) {
        console.warn(
          `Expected array of policies for ${role.name}, got: ${typeof rawPolicies}`,
        );
        continue;
      }

      const validPolicies = this.cleanAndValidatePolicies(rawPolicies);
      const genericOrchestratorPolicies = validPolicies.filter(
        (policy) =>
          policy.permission === "orchestrator.workflow" ||
          policy.permission === "orchestrator.workflow.use",
      );

      if (genericOrchestratorPolicies.length > 0) {
        const policiesToDelete: Policy[] = genericOrchestratorPolicies.map(
          (p) => ({
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

        if (!deleteResponse.ok()) {
          throw new Error(
            `Failed to remove orchestrator policies from ${role.name}: ${await deleteResponse.text()}`,
          );
        }

        // Only save policies after successful deletion
        this.savedGenericPolicies.push({
          roleName: roleNameForApi,
          policies: policiesToDelete,
        });
      }
    }

    console.log(
      `Saved ${this.savedGenericPolicies.length} role(s) with generic orchestrator policies for restoration`,
    );

    return this.savedGenericPolicies;
  }

  /**
   * Restores any generic orchestrator.workflow permissions that were previously removed.
   * Throws an error if restoration fails to ensure test environment integrity.
   *
   * @param rbacApi - The RBAC API instance
   * @throws Error if any policy restoration fails
   */
  async restoreGenericOrchestratorPermissions(
    rbacApi: RhdhRbacApi,
  ): Promise<void> {
    const errors: string[] = [];

    for (const saved of this.savedGenericPolicies) {
      console.log(
        `Restoring generic orchestrator policies to ${saved.roleName}:`,
        saved.policies,
      );
      const restoreResponse = await rbacApi.createPolicies(saved.policies);
      if (!restoreResponse.ok()) {
        const errorText = await restoreResponse.text();
        errors.push(
          `Failed to restore policies to ${saved.roleName}: ${errorText}`,
        );
      }
    }

    // Reset state after restoration attempt
    this.savedGenericPolicies = [];

    if (errors.length > 0) {
      throw new Error(
        `Policy restoration failed. Environment may be in inconsistent state:\n${errors.join("\n")}`,
      );
    }
  }

  /**
   * Gets the saved policies (useful for debugging or verification).
   */
  getSavedPolicies(): SavedRolePolicy[] {
    return this.savedGenericPolicies;
  }
}
