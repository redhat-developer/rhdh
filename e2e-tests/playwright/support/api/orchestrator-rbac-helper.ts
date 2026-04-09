import RhdhRbacApi from "./rbac-api";
import { Policy } from "./rbac-api-structures";
import { Response } from "../pages/rbac";

/**
 * Generic orchestrator workflow permissions that override specific workflow deny policies.
 * Per RHDH documentation, these must be removed before testing individual workflow denials.
 * @see https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.8/html-single/orchestrator_in_red_hat_developer_hub/index#assembly-orchestrator-rbac
 */
const genericWorkflowPermissions = [
  "orchestrator.workflow",
  "orchestrator.workflow.use",
] as const;

/**
 * Represents saved RBAC policies for a role that can be restored later.
 */
interface SavedRolePolicy {
  roleName: string;
  policies: Policy[];
}

/**
 * Helper class for managing orchestrator RBAC policies during tests.
 *
 * This is needed because generic orchestrator.workflow permissions override
 * specific workflow deny policies. Tests that need to verify individual
 * workflow denials must first remove any generic orchestrator.workflow permissions.
 *
 * @see https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.8/html-single/orchestrator_in_red_hat_developer_hub/index#assembly-orchestrator-rbac
 *
 * Usage:
 *   const helper = new OrchestratorRbacHelper(rbacApi);
 *   await helper.removeGenericOrchestratorPermissions(userEntityRef);
 *   // ... run tests ...
 *   await helper.restoreGenericOrchestratorPermissions();
 */
export class OrchestratorRbacHelper {
  private savedGenericPolicies: SavedRolePolicy[] = [];
  private readonly rbacApi: RhdhRbacApi;

  constructor(rbacApi: RhdhRbacApi) {
    this.rbacApi = rbacApi;
  }

  /**
   * Removes any generic orchestrator.workflow permissions for the specified user.
   * Saves the removed policies so they can be restored later.
   *
   * @param userEntityRef - The user entity reference (e.g., "user:default/rhdh-qe")
   * @returns The saved policies that were removed
   */
  async removeGenericOrchestratorPermissions(
    userEntityRef: string,
  ): Promise<SavedRolePolicy[]> {
    this.savedGenericPolicies = [];

    const rolesResponse = await this.rbacApi.getRoles();
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
      const policiesResponse =
        await this.rbacApi.getPoliciesByRole(roleNameForApi);

      if (!policiesResponse.ok()) continue;

      const policies = (await Response.removeMetadataFromResponse(
        policiesResponse,
      )) as { permission: string; policy: string; effect: string }[];

      const genericOrchestratorPolicies = policies.filter((policy) =>
        genericWorkflowPermissions.includes(
          policy.permission as (typeof genericWorkflowPermissions)[number],
        ),
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
        const deleteResponse = await this.rbacApi.deletePolicy(
          roleNameForApi,
          policiesToDelete,
        );

        if (!deleteResponse.ok()) {
          throw new Error(
            `Failed to remove orchestrator policies from ${role.name}: ${await deleteResponse.text()}`,
          );
        }

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
   * @throws Error if any policy restoration fails
   */
  async restoreGenericOrchestratorPermissions(): Promise<void> {
    const errors: string[] = [];

    for (const saved of this.savedGenericPolicies) {
      console.log(
        `Restoring generic orchestrator policies to ${saved.roleName}:`,
        saved.policies,
      );
      const restoreResponse = await this.rbacApi.createPolicies(saved.policies);
      if (!restoreResponse.ok()) {
        const errorText = await restoreResponse.text();
        errors.push(
          `Failed to restore policies to ${saved.roleName}: ${errorText}`,
        );
      }
    }

    this.savedGenericPolicies = [];

    if (errors.length > 0) {
      throw new Error(
        `Policy restoration failed. Environment may be in inconsistent state:\n${errors.join("\n")}`,
      );
    }
  }
}
