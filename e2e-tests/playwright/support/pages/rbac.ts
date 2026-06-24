import { APIResponse, Page, expect } from "@playwright/test";

import { UIhelper } from "../../utils/ui-helper";
import { Policy, Role } from "../api/rbac-api-structures";

export class Roles {
  private readonly page: Page;
  private readonly uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }
  static getRolesListCellsIdentifier() {
    const roleName = /^(role|user|group):[a-zA-Z]+\/[\w@*.~-]+$/u;
    const usersAndGroups =
      /^(1\s(user|group)|[2-9]\s(users|groups))(, (1\s(user|group)|[2-9]\s(users|groups)))?$/u;
    const permissionPolicies = /\d/u;
    return [roleName, usersAndGroups, permissionPolicies];
  }

  static getUsersAndGroupsListCellsIdentifier() {
    const name = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/u;
    const type = /^(User|Group)$/u;
    const members = /^(-|\d+)$/u;
    return [name, type, members];
  }

  static getPermissionPoliciesListCellsIdentifier() {
    const policies = /^(?:(Read|Create|Update|Delete)(?:, (?:Read|Create|Update|Delete))*|Use)$/u;
    return [policies];
  }

  //Depending on the version of the Backstage, it can be 'Permission Policies' or 'Accessible Plugins'
  // Accepts either term
  static getRolesListColumnsText() {
    return [/^Name$/u, /^Users and groups$/u, /Permission Policies|Accessible plugins/u];
  }

  static getUsersAndGroupsListColumnsText() {
    return ["Name", "Type", "Members"];
  }

  static getPermissionPoliciesListColumnsText() {
    return ["Plugin", "Permission", "Policies"];
  }
}

export async function removeMetadataFromResponse(response: APIResponse): Promise<unknown[]> {
  try {
    const responseJson: unknown = await response.json();

    if (!Array.isArray(responseJson)) {
      console.warn(`Expected an array but received: ${JSON.stringify(responseJson)}`);
      return [];
    }

    return responseJson.map((item: unknown) => {
      if (typeof item === "object" && item !== null && "metadata" in item) {
        const record = { ...(item as Record<string, unknown>) };
        delete record.metadata;
        return record;
      }
      return item;
    });
  } catch (error) {
    console.error("Error processing API response:", error);
    throw new Error("Failed to process the API response", { cause: error });
  }
}

export async function checkRbacResponse(response: APIResponse, expected: Role[] | Policy[]) {
  const cleanResponse = await removeMetadataFromResponse(response);
  expect(cleanResponse).toEqual(expected);
}
