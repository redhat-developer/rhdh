import "isomorphic-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { Client, PageCollection } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { User, Group } from "@microsoft/microsoft-graph-types";
import {
  NetworkManagementClient,
  NetworkSecurityGroupsGetResponse,
  SecurityRulesGetResponse,
} from "@azure/arm-network";

export class MSClient {
  private clientSecretCredential: ClientSecretCredential | undefined;
  private appClient: Client | undefined;
  private armNetworkClient: NetworkManagementClient | undefined;
  private readonly clientId: string;
  private readonly tenantId: string;
  private readonly clientSecret: string;
  private readonly subscriptionId?: string;

  constructor(
    clientId: string,
    clientSecret: string,
    tenantId: string,
    subscriptionId?: string,
  ) {
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

  private initializeArmNetworkClient(): void {
    if (!this.subscriptionId) {
      throw new Error(
        "Subscription ID is required for ARM operations. Please provide it in the constructor.",
      );
    }

    if (!this.clientSecretCredential) {
      this.clientSecretCredential = new ClientSecretCredential(
        this.tenantId,
        this.clientId,
        this.clientSecret,
      );
    }

    if (!this.armNetworkClient) {
      this.armNetworkClient = new NetworkManagementClient(
        this.clientSecretCredential,
        this.subscriptionId,
      );
    }
  }

  private ensureInitialized(): void {
    if (!this.appClient) {
      this.initializeGraphForAppOnlyAuth();
    }
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
      console.log(`[AZURE] Getting redirect URLs for app: ${this.clientId}`);
      const app = await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .get();
      const redirectUrls = app?.web?.redirectUris || [];
      console.log(`[AZURE] Found ${redirectUrls.length} redirect URLs`);
      return redirectUrls;
    } catch (e) {
      console.error("[AZURE] Failed to get app redirect URLs:", e);
      throw e;
    }
  }

  async addAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      console.log(
        `[AZURE] Adding ${redirectUrls.length} redirect URLs to app: ${this.clientId}`,
      );
      const currentUrls = await this.getAppRedirectUrlsAsync();
      const newUrls = [...new Set([...currentUrls, ...redirectUrls])];

      console.log(
        `[AZURE] Updating app with ${newUrls.length} total redirect URLs`,
      );
      await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .update({
          web: {
            redirectUris: newUrls,
          },
        });
      console.log(`[AZURE] Successfully added redirect URLs to app`);
    } catch (e) {
      console.error("[AZURE] Failed to add app redirect URLs:", e);
      throw e;
    }
  }

  async removeAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      console.log(
        `[AZURE] Removing ${redirectUrls.length} redirect URLs from app: ${this.clientId}`,
      );
      const currentUrls = await this.getAppRedirectUrlsAsync();
      const newUrls = currentUrls.filter((url) => !redirectUrls.includes(url));

      console.log(
        `[AZURE] Updating app with ${newUrls.length} remaining redirect URLs`,
      );
      await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .update({
          web: {
            redirectUris: newUrls,
          },
        });
      console.log(`[AZURE] Successfully removed redirect URLs from app`);
    } catch (e) {
      console.error("[AZURE] Failed to remove app redirect URLs:", e);
      throw e;
    }
  }

  async updateAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    this.ensureInitialized();
    try {
      console.log(
        `[AZURE] Updating redirect URLs for app: ${this.clientId} with ${redirectUrls.length} URLs`,
      );
      await this.appClient
        ?.api(`/applications(appId='{${this.clientId}}')`)
        .update({
          web: {
            redirectUris: redirectUrls,
          },
        });
      console.log(`[AZURE] Successfully updated redirect URLs for app`);
    } catch (e) {
      console.error("[AZURE] Failed to update app redirect URLs:", e);
      throw e;
    }
  }

  static formatUPNToEntity(user: string): string {
    return user.replace("@", "_");
  }

  async getNetworkSecurityGroupRuleAsync(
    resourceGroupName: string,
    nsgName: string,
    ruleName: string,
  ): Promise<SecurityRulesGetResponse | null> {
    this.ensureArmInitialized();
    try {
      console.log(
        `Getting network security group rule ${ruleName} from NSG ${nsgName} in resource group ${resourceGroupName}`,
      );

      return await this.armNetworkClient?.securityRules.get(
        resourceGroupName,
        nsgName,
        ruleName,
      );
    } catch (e) {
      if (e?.statusCode === 404) {
        console.log(
          `Network security group rule ${ruleName} not found in NSG ${nsgName}`,
        );
        return null;
      }
      console.error("Failed to get network security group rule:", e);
      throw e;
    }
  }

  async getPublicIpAsync(): Promise<string> {
    try {
      console.log("Fetching public IP address...");
      const response = await fetch("https://api.ipify.org?format=json");

      if (!response.ok) {
        throw new Error(
          `Failed to fetch public IP: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      const publicIp = data.ip;

      console.log(`Public IP address: ${publicIp}`);
      return publicIp;
    } catch (e) {
      console.error("Failed to get public IP address:", e);
      throw e;
    }
  }

  async getNetworkSecurityGroupAsync(
    resourceGroupName: string,
    nsgName: string,
  ): Promise<NetworkSecurityGroupsGetResponse> {
    this.ensureArmInitialized();
    try {
      console.log(
        `Getting network security group ${nsgName} from resource group ${resourceGroupName}`,
      );

      return await this.armNetworkClient?.networkSecurityGroups.get(
        resourceGroupName,
        nsgName,
      );
    } catch (e) {
      console.error("Failed to get network security group:", e);
      throw e;
    }
  }

  async allowPublicIpInNSG(
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

    try {
      // Step 1: Get public IP (for logging purposes only)
      console.log("[NSG] Getting current public IP address...");
      const publicIp = await this.getPublicIpAsync();
      console.log(`[NSG] Public IP obtained: ${publicIp}`);

      // Step 2: Generate unique rule name
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const ruleName = `${baseRuleName}-${timestamp}-${randomSuffix}`;
      console.log(`[NSG] Generated unique rule name: ${ruleName}`);

      // Step 3: Verify NSG exists
      console.log(
        `[NSG] Verifying NSG exists: ${nsgName} in resource group: ${resourceGroupName}`,
      );
      const nsg = await this.getNetworkSecurityGroupAsync(
        resourceGroupName,
        nsgName,
      );
      console.log(`[NSG] NSG verified: ${nsg.name} (ID: ${nsg.id})`);

      // Step 4: Get existing rule to use as template
      console.log(`[NSG] Getting existing rule as template: ${baseRuleName}`);
      const templateRule = await this.getNetworkSecurityGroupRuleAsync(
        resourceGroupName,
        nsgName,
        baseRuleName,
      );

      if (!templateRule) {
        throw new Error(
          `Template rule ${baseRuleName} not found in NSG ${nsgName}`,
        );
      }
      console.log(
        `[NSG] Template rule found: ${templateRule.name} (Priority: ${templateRule.priority})`,
      );

      // Step 5: Create new rule with wildcard IP (*)
      // Find an available priority to avoid conflicts
      const existingRules = this.armNetworkClient?.securityRules.list(
        resourceGroupName,
        nsgName,
      );
      const existingPriorities = new Set();

      if (existingRules) {
        for await (const rule of existingRules) {
          existingPriorities.add(rule.priority);
        }
      }

      // Find the first available priority starting from 100
      let availablePriority = 200;
      while (existingPriorities.has(availablePriority)) {
        availablePriority++;
      }

      console.log(
        `[NSG] Template rule priority: ${templateRule.priority}, Using available priority: ${availablePriority}`,
      );

      const newRule = {
        ...templateRule,
        name: ruleName,
        priority: availablePriority,
        sourceAddressPrefix: "*", // Allow all IPs instead of specific public IP
        sourceAddressPrefixes: null, // Use single IP instead of array
        description: `Temporary E2E test rule allowing all IPs - Created at ${new Date().toISOString()}`,
      };

      console.log(`[NSG] Creating new rule: ${ruleName} with wildcard IP (*)`);
      console.log(
        `[NSG] Rule details: Priority=${newRule.priority}, Protocol=${newRule.protocol}, Access=${newRule.access}`,
      );

      const rulePoller =
        await this.armNetworkClient?.securityRules.beginCreateOrUpdate(
          resourceGroupName,
          nsgName,
          ruleName,
          newRule,
        );

      console.log(`[NSG] Waiting for rule creation to complete...`);
      const createdRule = await rulePoller.pollUntilDone();

      console.log(`[NSG] Rule created successfully: ${ruleName}`);
      console.log(`[NSG] Rule ID: ${createdRule.id}`);

      // Step 6: Create cleanup function
      const cleanup = async (): Promise<void> => {
        try {
          console.log(`[NSG] Starting cleanup for rule: ${ruleName}`);
          console.log(`[NSG] Verifying rule exists before deletion...`);

          const existingRule = await this.getNetworkSecurityGroupRuleAsync(
            resourceGroupName,
            nsgName,
            ruleName,
          );
          if (!existingRule) {
            console.log(
              `[NSG] Rule ${ruleName} not found during cleanup - may have been already deleted`,
            );
            return;
          }

          console.log(`[NSG] Deleting rule: ${ruleName}`);
          const deletePoller =
            await this.armNetworkClient?.securityRules.beginDelete(
              resourceGroupName,
              nsgName,
              ruleName,
            );
          console.log(`[NSG] Waiting for rule deletion to complete...`);
          await deletePoller.pollUntilDone();
          console.log(`[NSG] Rule deleted successfully: ${ruleName}`);
        } catch (error) {
          console.error(`[NSG] Failed to cleanup rule ${ruleName}:`, error);
          console.error(`[NSG] Cleanup error details:`, {
            message: error.message,
            statusCode: error.statusCode,
            code: error.code,
          });
          // Don't throw - cleanup failures shouldn't break tests
        }
      };

      return {
        publicIp,
        ruleName,
        resourceGroupName,
        nsgName,
        cleanup,
      };
    } catch (error) {
      console.error(`[NSG] Failed to allow public IP in NSG:`, error);
      console.error(`[NSG] Error details:`, {
        message: error.message,
        statusCode: error.statusCode,
        code: error.code,
        body: error.body,
      });
      throw error;
    }
  }
}
