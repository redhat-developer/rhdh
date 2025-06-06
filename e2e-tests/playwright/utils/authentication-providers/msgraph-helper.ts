import "isomorphic-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { Client, PageCollection } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { User, Group } from "@microsoft/microsoft-graph-types";

export class MSGraphClient {
  private clientSecretCredential: ClientSecretCredential | undefined;
  private appClient: Client | undefined;
  private readonly clientId: string;
  private readonly tenantId: string;
  private readonly clientSecret: string;

  constructor(clientId: string, clientSecret: string, tenantId: string) {
    if (!clientId || !tenantId || !clientSecret) {
      console.error("Missing required credentials");
      throw new Error("Client ID, Tenant ID, and Client Secret are required");
    }

    this.clientId = clientId;
    this.tenantId = tenantId;
    this.clientSecret = clientSecret;
  }

  private initializeGraphForAppOnlyAuth(): void {
    if (!this.clientSecretCredential) {
      this.clientSecretCredential = new ClientSecretCredential(
        this.tenantId,
        this.clientId,
        this.clientSecret,
      );
    }

    if (!this.appClient) {
      const authProvider = new TokenCredentialAuthenticationProvider(
        this.clientSecretCredential,
        {
          scopes: ["https://graph.microsoft.com/.default"],
        },
      );

      this.appClient = Client.initWithMiddleware({
        authProvider: authProvider,
      });
    }
  }

  private ensureInitialized(): void {
    if (!this.appClient) {
      this.initializeGraphForAppOnlyAuth();
    }
  }

  async getAppOnlyTokenAsync(): Promise<string> {
    this.ensureInitialized();
    if (!this.clientSecretCredential) {
      throw new Error("Graph has not been initialized for app-only auth");
    }

    const response = await this.clientSecretCredential.getToken([
      "https://graph.microsoft.com/.default",
    ]);
    return response.token;
  }

  async getGroupsAsync(): Promise<PageCollection> {
    this.ensureInitialized();
    try {
      return this.appClient
        ?.api("/groups")
        .select(["id", "displayName", "members", "owners"])
        .get();
    } catch (e) {
      console.error("Failed to get groups:", e);
      throw e;
    }
  }

  async getGroupByNameAsync(groupName: string): Promise<PageCollection> {
    this.ensureInitialized();
    try {
      return await this.appClient
        ?.api("/groups")
        .filter(`displayName eq '${groupName}'`)
        .top(1)
        .get();
    } catch (e) {
      if (e?.statusCode === 404) {
        console.log(`Group ${groupName} not found`);
        return null;
      }
      console.error("Failed to get group:", e);
      throw e;
    }
  }

  async getGroupMembersAsync(groupId: string): Promise<PageCollection> {
    this.ensureInitialized();
    try {
      return this.appClient
        ?.api(`/groups/${groupId}/members`)
        .select([
          "displayName",
          "id",
          "mail",
          "userPrincipalName",
          "surname",
          "firstname",
        ])
        .get();
    } catch (e) {
      console.error("Failed to get group members:", e);
      throw e;
    }
  }

  async createUserAsync(user: User): Promise<User> {
    this.ensureInitialized();
    try {
      console.log(`Creating user ${user.userPrincipalName}`);
      return await this.appClient?.api("/users").post(user);
    } catch (e) {
      console.error("Failed to create user:", e);
      throw e;
    }
  }

  async createGroupAsync(group: Group): Promise<Group> {
    this.ensureInitialized();
    try {
      console.log(`Creating group ${group.displayName}`);
      return await this.appClient?.api("/groups").post(group);
    } catch (e) {
      console.error("Failed to create group:", e);
      throw e;
    }
  }

  async getUsersAsync(): Promise<PageCollection> {
    this.ensureInitialized();
    try {
      return this.appClient
        ?.api("/users")
        .select([
          "displayName",
          "id",
          "mail",
          "userPrincipalName",
          "surname",
          "firstname",
        ])
        .top(25)
        .orderby("userPrincipalName")
        .get();
    } catch (e) {
      console.error("Failed to get users:", e);
      throw e;
    }
  }

  async deleteUserByUpnAsync(upn: string): Promise<User> {
    this.ensureInitialized();
    try {
      console.log(`Deleting user ${upn}`);
      return this.appClient?.api("/users/" + upn).delete();
    } catch (e) {
      console.error("Failed to delete user:", e);
      throw e;
    }
  }

  async deleteGroupByIdAsync(id: string): Promise<User> {
    this.ensureInitialized();
    try {
      console.log(`Deleting group ${id}`);
      return this.appClient?.api("/groups/" + id).delete();
    } catch (e) {
      console.error("Failed to delete group:", e);
      throw e;
    }
  }

  async getUserByUpnAsync(upn: string): Promise<User | null> {
    this.ensureInitialized();
    try {
      return await this.appClient?.api("/users/" + upn).get();
    } catch (e) {
      if (e?.statusCode === 404) {
        console.log(`User ${upn} not found`);
        return null;
      }
      console.error("Failed to get user:", e);
      throw e;
    }
  }

  async addUserToGroupAsync(user: User, group: Group): Promise<Group> {
    this.ensureInitialized();
    const userDirectoryObject = {
      "@odata.id":
        "https://graph.microsoft.com/v1.0/users/" + user.userPrincipalName,
    };
    try {
      console.log(
        `Adding user ${user.userPrincipalName} to group ${group.displayName}`,
      );
      return await this.appClient
        ?.api("/groups/" + group.id + "/members/$ref")
        .post(userDirectoryObject);
    } catch (e) {
      console.error("Failed to add user to group:", e);
      throw e;
    }
  }

  async removeUserFromGroupAsync(user: User, group: Group): Promise<Group> {
    this.ensureInitialized();
    try {
      console.log(
        `Removing user ${user.userPrincipalName} from group ${group.displayName}`,
      );
      return await this.appClient
        ?.api(`/groups/${group.id}/members/${user.id}/$ref`)
        .delete();
    } catch (e) {
      console.error("Failed to remove user from group:", e);
      throw e;
    }
  }

  async addGroupToGroupAsync(subject: Group, target: Group): Promise<Group> {
    this.ensureInitialized();
    const userDirectoryObject = {
      "@odata.id": "https://graph.microsoft.com/v1.0/groups/" + subject.id,
    };
    try {
      console.log(
        `Adding group ${subject.displayName} to group ${target.displayName}`,
      );
      return await this.appClient
        ?.api("/groups/" + target.id + "/members/$ref")
        .post(userDirectoryObject);
    } catch (e) {
      console.error("Failed to add group to group:", e);
      throw e;
    }
  }

  async updateUserAsync(user: User, updatedUser: User): Promise<User> {
    this.ensureInitialized();
    try {
      console.log(`Updating user ${user.userPrincipalName}`);
      return await this.appClient
        ?.api("/users/" + user.userPrincipalName)
        .update(updatedUser);
    } catch (e) {
      console.error("Failed to update user:", e);
      throw e;
    }
  }

  async updateGroupAsync(group: Group, updatedGroup: Group): Promise<Group> {
    this.ensureInitialized();
    try {
      console.log(`Updating group ${group.displayName}`);
      return await this.appClient
        ?.api("/groups/" + group.id)
        .update(updatedGroup);
    } catch (e) {
      console.error("Failed to update group:", e);
      throw e;
    }
  }

  async getAppRedirectUrlsAsync(): Promise<string[]> {
    this.ensureInitialized();
    try {
      const app = await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .get();
      return app?.web?.redirectUris || [];
    } catch (e) {
      console.error("Failed to get app redirect URLs:", e);
      throw e;
    }
  }

  async addAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      const currentUrls = await this.getAppRedirectUrlsAsync();
      const newUrls = [...new Set([...currentUrls, ...redirectUrls])];

      console.log(`Adding redirect URLs to app ${this.clientId}`);
      await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .update({
          web: {
            redirectUris: newUrls,
          },
        });
    } catch (e) {
      console.error("Failed to add app redirect URLs:", e);
      throw e;
    }
  }

  async removeAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      const currentUrls = await this.getAppRedirectUrlsAsync();
      const newUrls = currentUrls.filter((url) => !redirectUrls.includes(url));

      console.log(`Removing redirect URLs from app ${this.clientId}`);
      await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .update({
          web: {
            redirectUris: newUrls,
          },
        });
    } catch (e) {
      console.error("Failed to remove app redirect URLs:", e);
      throw e;
    }
  }

  async updateAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      console.log(`Updating redirect URLs for app ${this.clientId}`);
      await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .update({
          web: {
            redirectUris: redirectUrls,
          },
        });
    } catch (e) {
      console.error("Failed to update app redirect URLs:", e);
      throw e;
    }
  }

  static formatUPNToEntity(user: string): string {
    return user.replace("@", "_");
  }
}
