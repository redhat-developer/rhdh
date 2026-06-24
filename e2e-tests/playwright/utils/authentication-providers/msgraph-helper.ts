// oxlint-disable-next-line import/no-unassigned-import -- fetch polyfill required by Graph SDK
import "isomorphic-fetch";
import { NetworkManagementClient, SecurityRulesGetResponse } from "@azure/arm-network";
import { ClientSecretCredential } from "@azure/identity";
import { Client, PageCollection } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { User, Group } from "@microsoft/microsoft-graph-types";

import { hasStatusCode } from "../errors";
import {
  allowPublicIpInNsg,
  getNetworkSecurityGroup,
  getNetworkSecurityGroupRule,
} from "./msgraph-helper-nsg";

interface AzureApplicationWeb {
  redirectUris?: string[];
}

interface AzureApplicationResponse {
  web?: AzureApplicationWeb;
}

interface IpifyResponse {
  ip: string;
}

function isAzureApplicationResponse(value: unknown): value is AzureApplicationResponse {
  return typeof value === "object" && value !== null;
}

function isIpifyResponse(value: unknown): value is IpifyResponse {
  return (
    typeof value === "object" && value !== null && "ip" in value && typeof value.ip === "string"
  );
}

export class MSClient {
  private clientSecretCredential: ClientSecretCredential | undefined;
  private appClient: Client | undefined;
  private armNetworkClient: NetworkManagementClient | undefined;
  private readonly clientId: string;
  private readonly tenantId: string;
  private readonly clientSecret: string;
  private readonly subscriptionId?: string;

  constructor(clientId: string, clientSecret: string, tenantId: string, subscriptionId?: string) {
    if (!clientId || !tenantId || !clientSecret) {
      console.error("Missing required credentials");
      throw new Error("Client ID, Tenant ID, and Client Secret are required");
    }

    this.clientId = clientId;
    this.tenantId = tenantId;
    this.clientSecret = clientSecret;
    this.subscriptionId = subscriptionId;
  }

  private initializeGraphForAppOnlyAuth(): void {
    this.clientSecretCredential ??= new ClientSecretCredential(
      this.tenantId,
      this.clientId,
      this.clientSecret,
    );

    if (this.appClient === undefined) {
      const authProvider = new TokenCredentialAuthenticationProvider(this.clientSecretCredential, {
        scopes: ["https://graph.microsoft.com/.default"],
      });

      this.appClient = Client.initWithMiddleware({
        authProvider: authProvider,
      });
    }
  }

  private initializeArmNetworkClient(): void {
    if (this.subscriptionId === undefined || this.subscriptionId === "") {
      throw new Error(
        "Subscription ID is required for ARM operations. Please provide it in the constructor.",
      );
    }

    this.clientSecretCredential ??= new ClientSecretCredential(
      this.tenantId,
      this.clientId,
      this.clientSecret,
    );

    this.armNetworkClient ??= new NetworkManagementClient(
      this.clientSecretCredential,
      this.subscriptionId,
    );
  }

  private ensureInitialized(): void {
    if (!this.appClient) {
      this.initializeGraphForAppOnlyAuth();
    }
  }

  private getAppClient(): Client {
    this.ensureInitialized();
    if (!this.appClient) {
      throw new Error("Graph client not initialized");
    }
    return this.appClient;
  }

  /** Graph SDK requests return untyped data; narrow at call sites. */
  private async graphGet<T>(request: (client: Client) => Promise<unknown>): Promise<T> {
    const result: unknown = await request(this.getAppClient());
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Graph SDK has no typed responses
    return result as T;
  }

  /** Graph SDK mutations return untyped data; narrow at call sites. */
  private async graphMutate<T>(request: (client: Client) => Promise<unknown>): Promise<T> {
    const result: unknown = await request(this.getAppClient());
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Graph SDK has no typed responses
    return result as T;
  }

  private async graphDelete(request: (client: Client) => Promise<unknown>): Promise<void> {
    await request(this.getAppClient());
  }

  private ensureArmInitialized(): void {
    if (!this.armNetworkClient) {
      this.initializeArmNetworkClient();
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
    try {
      return await this.graphGet<PageCollection>((client) =>
        client.api("/groups").select(["id", "displayName", "members", "owners"]).get(),
      );
    } catch (e) {
      console.error("Failed to get groups:", e);
      throw e;
    }
  }

  async getGroupByNameAsync(groupName: string): Promise<PageCollection | null> {
    try {
      return await this.graphGet<PageCollection>((client) =>
        client.api("/groups").filter(`displayName eq '${groupName}'`).top(1).get(),
      );
    } catch (e) {
      if (hasStatusCode(e) && e.statusCode === 404) {
        console.log(`Group ${groupName} not found`);
        return null;
      }
      console.error("Failed to get group:", e);
      throw e;
    }
  }

  async getGroupMembersAsync(groupId: string): Promise<PageCollection> {
    try {
      return await this.graphGet<PageCollection>((client) =>
        client
          .api(`/groups/${groupId}/members`)
          .select(["displayName", "id", "mail", "userPrincipalName", "surname", "firstname"])
          .get(),
      );
    } catch (e) {
      console.error("Failed to get group members:", e);
      throw e;
    }
  }

  async createUserAsync(user: User): Promise<User> {
    try {
      console.log(`Creating user ${user.userPrincipalName}`);
      return await this.graphMutate<User>((client) => client.api("/users").post(user));
    } catch (e) {
      console.error("Failed to create user:", e);
      throw e;
    }
  }

  async createGroupAsync(group: Group): Promise<Group> {
    try {
      console.log(`Creating group ${group.displayName}`);
      return await this.graphMutate<Group>((client) => client.api("/groups").post(group));
    } catch (e) {
      console.error("Failed to create group:", e);
      throw e;
    }
  }

  async getUsersAsync(): Promise<PageCollection> {
    try {
      return await this.graphGet<PageCollection>((client) =>
        client
          .api("/users")
          .select(["displayName", "id", "mail", "userPrincipalName", "surname", "firstname"])
          .top(25)
          .orderby("userPrincipalName")
          .get(),
      );
    } catch (e) {
      console.error("Failed to get users:", e);
      throw e;
    }
  }

  async deleteUserByUpnAsync(upn: string): Promise<void> {
    try {
      console.log(`Deleting user ${upn}`);
      await this.graphDelete((client) => client.api("/users/" + upn).delete());
    } catch (e) {
      console.error("Failed to delete user:", e);
      throw e;
    }
  }

  async deleteGroupByIdAsync(id: string): Promise<void> {
    try {
      console.log(`Deleting group ${id}`);
      await this.graphDelete((client) => client.api("/groups/" + id).delete());
    } catch (e) {
      console.error("Failed to delete group:", e);
      throw e;
    }
  }

  async getUserByUpnAsync(upn: string): Promise<User | null> {
    try {
      return await this.graphGet<User>((client) => client.api("/users/" + upn).get());
    } catch (e) {
      if (hasStatusCode(e) && e.statusCode === 404) {
        console.log(`User ${upn} not found`);
        return null;
      }
      console.error("Failed to get user:", e);
      throw e;
    }
  }

  async addUserToGroupAsync(user: User, group: Group): Promise<void> {
    const userDirectoryObject = {
      "@odata.id": "https://graph.microsoft.com/v1.0/users/" + user.userPrincipalName,
    };
    try {
      console.log(`Adding user ${user.userPrincipalName} to group ${group.displayName}`);
      await this.graphMutate<void>((client) =>
        client.api("/groups/" + group.id + "/members/$ref").post(userDirectoryObject),
      );
    } catch (e) {
      console.error("Failed to add user to group:", e);
      throw e;
    }
  }

  async removeUserFromGroupAsync(user: User, group: Group): Promise<void> {
    try {
      console.log(`Removing user ${user.userPrincipalName} from group ${group.displayName}`);
      await this.graphDelete((client) =>
        client.api(`/groups/${group.id}/members/${user.id}/$ref`).delete(),
      );
    } catch (e) {
      console.error("Failed to remove user from group:", e);
      throw e;
    }
  }

  async addGroupToGroupAsync(subject: Group, target: Group): Promise<void> {
    const userDirectoryObject = {
      "@odata.id": "https://graph.microsoft.com/v1.0/groups/" + subject.id,
    };
    try {
      console.log(`Adding group ${subject.displayName} to group ${target.displayName}`);
      await this.graphMutate<void>((client) =>
        client.api("/groups/" + target.id + "/members/$ref").post(userDirectoryObject),
      );
    } catch (e) {
      console.error("Failed to add group to group:", e);
      throw e;
    }
  }

  async updateUserAsync(user: User, updatedUser: User): Promise<User> {
    try {
      console.log(`Updating user ${user.userPrincipalName}`);
      return await this.graphMutate<User>((client) =>
        client.api("/users/" + user.userPrincipalName).update(updatedUser),
      );
    } catch (e) {
      console.error("Failed to update user:", e);
      throw e;
    }
  }

  async updateGroupAsync(group: Group, updatedGroup: Group): Promise<Group> {
    try {
      console.log(`Updating group ${group.displayName}`);
      return await this.graphMutate<Group>((client) =>
        client.api("/groups/" + group.id).update(updatedGroup),
      );
    } catch (e) {
      console.error("Failed to update group:", e);
      throw e;
    }
  }

  async getAppRedirectUrlsAsync(): Promise<string[]> {
    try {
      console.log(`[AZURE] Getting redirect URLs for app: ${this.clientId}`);
      const app = await this.graphGet<unknown>((client) =>
        client.api(`/applications(appId='{${this.clientId}}')`).get(),
      );
      if (!isAzureApplicationResponse(app)) {
        return [];
      }
      const redirectUrls = app.web?.redirectUris ?? [];
      console.log(`[AZURE] Found ${redirectUrls.length} redirect URLs`);
      return redirectUrls;
    } catch (e) {
      console.error("[AZURE] Failed to get app redirect URLs:", e);
      throw e;
    }
  }

  async addAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    try {
      console.log(`[AZURE] Adding ${redirectUrls.length} redirect URLs to app: ${this.clientId}`);
      const currentUrls = await this.getAppRedirectUrlsAsync();
      const newUrls = [...new Set([...currentUrls, ...redirectUrls])];

      console.log(`[AZURE] Updating app with ${newUrls.length} total redirect URLs`);
      await this.graphMutate<void>((client) =>
        client.api(`/applications(appId='{${this.clientId}}')`).update({
          web: {
            redirectUris: newUrls,
          },
        }),
      );
      console.log(`[AZURE] Successfully added redirect URLs to app`);
    } catch (e) {
      console.error("[AZURE] Failed to add app redirect URLs:", e);
      throw e;
    }
  }

  async removeAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    try {
      console.log(
        `[AZURE] Removing ${redirectUrls.length} redirect URLs from app: ${this.clientId}`,
      );
      const currentUrls = await this.getAppRedirectUrlsAsync();
      const newUrls = currentUrls.filter((url) => !redirectUrls.includes(url));

      console.log(`[AZURE] Updating app with ${newUrls.length} remaining redirect URLs`);
      await this.graphMutate<void>((client) =>
        client.api(`/applications(appId='{${this.clientId}}')`).update({
          web: {
            redirectUris: newUrls,
          },
        }),
      );
      console.log(`[AZURE] Successfully removed redirect URLs from app`);
    } catch (e) {
      console.error("[AZURE] Failed to remove app redirect URLs:", e);
      throw e;
    }
  }

  async updateAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    try {
      console.log(
        `[AZURE] Updating redirect URLs for app: ${this.clientId} with ${redirectUrls.length} URLs`,
      );
      await this.graphMutate<void>((client) =>
        client.api(`/applications(appId='{${this.clientId}}')`).update({
          web: {
            redirectUris: redirectUrls,
          },
        }),
      );
      console.log(`[AZURE] Successfully updated redirect URLs for app`);
    } catch (e) {
      console.error("[AZURE] Failed to update app redirect URLs:", e);
      throw e;
    }
  }

  static formatUPNToEntity(user: string): string {
    return user.replace("@", "_");
  }

  getNetworkSecurityGroupRuleAsync(
    resourceGroupName: string,
    nsgName: string,
    ruleName: string,
  ): Promise<SecurityRulesGetResponse | null> {
    this.ensureArmInitialized();
    if (this.armNetworkClient === undefined) {
      throw new Error("ARM network client not initialized");
    }
    return getNetworkSecurityGroupRule(this.armNetworkClient, resourceGroupName, nsgName, ruleName);
  }

  async getPublicIpAsync(): Promise<string> {
    try {
      console.log("Fetching public IP address...");
      const response = await fetch("https://api.ipify.org?format=json");

      if (!response.ok) {
        throw new Error(`Failed to fetch public IP: ${response.status} ${response.statusText}`);
      }

      const data: unknown = await response.json();
      if (!isIpifyResponse(data)) {
        throw new Error("Invalid ipify response: missing ip field");
      }
      const publicIp = data.ip;

      console.log(`Public IP address: ${publicIp}`);
      return publicIp;
    } catch (e) {
      console.error("Failed to get public IP address:", e);
      throw e;
    }
  }

  getNetworkSecurityGroupAsync(resourceGroupName: string, nsgName: string) {
    this.ensureArmInitialized();
    if (this.armNetworkClient === undefined) {
      throw new Error("ARM network client not initialized");
    }
    return getNetworkSecurityGroup(this.armNetworkClient, resourceGroupName, nsgName);
  }

  allowPublicIpInNSG(
    resourceGroupName: string,
    nsgName: string,
    baseRuleName: string = "AllowE2EJobs",
  ): Promise<{
    publicIp: string;
    ruleName: string;
    resourceGroupName: string;
    nsgName: string;
    cleanup: () => Promise<void>;
  }> {
    this.ensureArmInitialized();
    if (this.armNetworkClient === undefined) {
      throw new Error("ARM network client not initialized");
    }
    return allowPublicIpInNsg(
      this.armNetworkClient,
      () => this.getPublicIpAsync(),
      resourceGroupName,
      nsgName,
      baseRuleName,
    );
  }
}
