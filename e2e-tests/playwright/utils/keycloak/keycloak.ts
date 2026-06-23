import { expect, Page } from "@playwright/test";

import { CatalogUsersPO } from "../../support/page-objects/catalog/catalog-users-obj";
import { UIhelper } from "../ui-helper";
import { base64Decode } from "../helper";
import Group from "./group";
import User from "./user";

interface AuthResponse {
  access_token: string;
}

function isAuthResponse(data: unknown): data is AuthResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "access_token" in data &&
    typeof Reflect.get(data, "access_token") === "string"
  );
}

function isUserArray(data: unknown): data is User[] {
  return Array.isArray(data);
}

function isGroupArray(data: unknown): data is Group[] {
  return Array.isArray(data);
}

class Keycloak {
  private readonly baseURL: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    this.baseURL = base64Decode(process.env.KEYCLOAK_AUTH_BASE_URL);
    this.realm = base64Decode(process.env.KEYCLOAK_AUTH_REALM);
    this.clientSecret = base64Decode(process.env.KEYCLOAK_AUTH_CLIENT_SECRET);
    this.clientId = base64Decode(process.env.KEYCLOAK_AUTH_CLIENTID);
  }

  async getAuthenticationToken(): Promise<string> {
    const response = await fetch(
      `${this.baseURL}/auth/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
      },
    );

    if (response.status !== 200) throw new Error("Failed to authenticate");
    const data: unknown = await response.json();
    if (!isAuthResponse(data)) {
      throw new Error("Failed to authenticate: invalid token response");
    }
    return data.access_token;
  }

  async getUsers(authToken: string): Promise<User[]> {
    const response = await fetch(`${this.baseURL}/auth/admin/realms/${this.realm}/users`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (response.status !== 200) {
      const errorText = await response.text();
      throw new Error(`Failed to get users: ${response.status} - ${errorText}`);
    }
    const data: unknown = await response.json();
    if (!isUserArray(data)) {
      throw new Error("Failed to get users: invalid response format");
    }
    return data;
  }

  async getGroupsOfUser(authToken: string, userId: string): Promise<Group[]> {
    const response = await fetch(
      `${this.baseURL}/auth/admin/realms/${this.realm}/users/${userId}/groups`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    if (response.status !== 200) {
      const errorText = await response.text();
      throw new Error(`Failed to get groups of user: ${response.status} - ${errorText}`);
    }
    const data: unknown = await response.json();
    if (!isGroupArray(data)) {
      throw new Error("Failed to get groups of user: invalid response format");
    }
    return data;
  }

  async checkUserDetails(
    page: Page,
    keycloakUser: User,
    token: string,
    uiHelper: UIhelper,
    keycloak: Keycloak,
  ) {
    await CatalogUsersPO.visitUserPage(page, keycloakUser.username);
    const emailLink = CatalogUsersPO.getEmailLink(page);
    await expect(emailLink).toBeVisible();
    await uiHelper.verifyDivHasText(`${keycloakUser.firstName} ${keycloakUser.lastName}`);

    const groups = await keycloak.getGroupsOfUser(token, keycloakUser.id);
    for (const group of groups) {
      const groupLink = CatalogUsersPO.getGroupLink(page, group.name);
      await expect(groupLink).toBeVisible();
    }

    await CatalogUsersPO.visitBaseURL(page);
  }
}

export default Keycloak;
