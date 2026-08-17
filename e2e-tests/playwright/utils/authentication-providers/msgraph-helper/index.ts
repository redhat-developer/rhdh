// oxlint-disable-next-line import/no-unassigned-import -- fetch polyfill required by Graph SDK
import "isomorphic-fetch";
import { NetworkManagementClient } from "@azure/arm-network";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";

import { allowPublicIpInNsg } from "./nsg";

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

  private ensureArmInitialized(): void {
    if (!this.armNetworkClient) {
      this.initializeArmNetworkClient();
    }
  }

  private async getAppRedirectUrlsAsync(): Promise<string[]> {
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

  private async updateAppRedirectUris(redirectUrls: string[], actionLabel: string): Promise<void> {
    try {
      console.log(`[AZURE] ${actionLabel} for app: ${this.clientId}`);
      await this.graphMutate<void>((client) =>
        client.api(`/applications(appId='{${this.clientId}}')`).update({
          web: {
            redirectUris: redirectUrls,
          },
        }),
      );
      console.log(`[AZURE] Successfully ${actionLabel.toLowerCase()} for app`);
    } catch (e) {
      console.error(`[AZURE] Failed to ${actionLabel.toLowerCase()}:`, e);
      throw e;
    }
  }

  async addAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    console.log(`[AZURE] Adding ${redirectUrls.length} redirect URLs to app: ${this.clientId}`);
    const currentUrls = await this.getAppRedirectUrlsAsync();
    const newUrls = [...new Set([...currentUrls, ...redirectUrls])];
    console.log(`[AZURE] Updating app with ${newUrls.length} total redirect URLs`);
    await this.updateAppRedirectUris(newUrls, "Updated redirect URLs");
  }

  async removeAppRedirectUrlsAsync(redirectUrls: string[]): Promise<void> {
    console.log(`[AZURE] Removing ${redirectUrls.length} redirect URLs from app: ${this.clientId}`);
    const currentUrls = await this.getAppRedirectUrlsAsync();
    const newUrls = currentUrls.filter((url) => !redirectUrls.includes(url));
    console.log(`[AZURE] Updating app with ${newUrls.length} remaining redirect URLs`);
    await this.updateAppRedirectUris(newUrls, "Removed redirect URLs");
  }

  private async getPublicIpAsync(): Promise<string> {
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
