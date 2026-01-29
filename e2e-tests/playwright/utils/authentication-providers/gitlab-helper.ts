export interface GitLabOAuthApp {
  id: number;
  application_id: string;
  application_name: string;
  secret: string;
  callback_url: string;
  scopes: string[];
}

interface GitLabOAuthAppResponse {
  id: number;
  application_id: string;
  application_name?: string;
  name?: string;
  secret: string;
  callback_url?: string;
  redirect_uri?: string;
  scopes?: string[];
}

interface GitLabConfig {
  host: string;
  personalAccessToken: string;
}

export class GitLabHelper {
  private config: GitLabConfig;
  private apiBaseUrl: string;

  constructor(config: GitLabConfig) {
    this.config = config;
    // Ensure host doesn't have protocol prefix
    const cleanHost = config.host.replace(/^https?:\/\//, "");
    this.apiBaseUrl = `https://${cleanHost}/api/v4`;
  }

  /**
   * Creates an OAuth application in GitLab
   * @param name - Name of the application
   * @param redirectUri - Redirect URI for OAuth callbacks
   * @param scopes - OAuth scopes (default: "api read_user write_repository sudo")
   * @param trusted - Whether the application is trusted (skips user authorization, default: true)
   * @returns The created OAuth application with id, application_id, and secret
   */
  async createOAuthApplication(
    name: string,
    redirectUri: string,
    scopes: string = "api read_user write_repository sudo",
    trusted: boolean = true,
  ): Promise<GitLabOAuthApp> {
    try {
      console.log(`[GITLAB] Creating OAuth application: ${name}`);
      console.log(`[GITLAB] Scopes: ${scopes}, Trusted: ${trusted}`);
      const response = await fetch(`${this.apiBaseUrl}/applications`, {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": this.config.personalAccessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name,
          redirect_uri: redirectUri,
          scopes: scopes,
          trusted: trusted,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create OAuth application: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const app = await response.json();

      // Validate required fields
      if (!app.id || !app.application_id || !app.secret) {
        // Log response without sensitive data
        const safeApp = { ...app };
        if (safeApp.secret) safeApp.secret = "***";
        console.error("[GITLAB] Unexpected API response structure:", safeApp);
        throw new Error(
          "GitLab API response missing required fields (id, application_id, or secret)",
        );
      }

      console.log(
        `[GITLAB] OAuth application created successfully with ID: ${app.id}`,
      );
      console.log(
        `[GITLAB] Application ID: ${app.application_id}, Secret: ${app.secret ? "***" : "not provided"}`,
      );

      return {
        id: app.id,
        application_id: app.application_id,
        application_name: app.application_name || app.name || name,
        secret: app.secret,
        callback_url: app.callback_url || app.redirect_uri || redirectUri,
        scopes:
          app.scopes || (typeof scopes === "string" ? scopes.split(" ") : []),
      };
    } catch (error) {
      console.error("[GITLAB] Failed to create OAuth application:", error);
      throw error;
    }
  }

  /**
   * Deletes an OAuth application from GitLab
   * @param applicationId - The ID of the application to delete
   */
  async deleteOAuthApplication(applicationId: number): Promise<void> {
    try {
      console.log(`[GITLAB] Deleting OAuth application: ${applicationId}`);
      const response = await fetch(
        `${this.apiBaseUrl}/applications/${applicationId}`,
        {
          method: "DELETE",
          headers: {
            "PRIVATE-TOKEN": this.config.personalAccessToken,
          },
        },
      );

      if (!response.ok) {
        // 404 is acceptable if the app was already deleted
        if (response.status === 404) {
          console.log(
            `[GITLAB] OAuth application ${applicationId} not found (may have been already deleted)`,
          );
          return;
        }
        const errorText = await response.text();
        throw new Error(
          `Failed to delete OAuth application: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      console.log(
        `[GITLAB] OAuth application ${applicationId} deleted successfully`,
      );
    } catch (error) {
      console.error(
        `[GITLAB] Failed to delete OAuth application ${applicationId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Lists all OAuth applications
   * @returns Array of OAuth applications
   */
  async listOAuthApplications(): Promise<GitLabOAuthApp[]> {
    try {
      console.log("[GITLAB] Listing OAuth applications");
      const response = await fetch(`${this.apiBaseUrl}/applications`, {
        method: "GET",
        headers: {
          "PRIVATE-TOKEN": this.config.personalAccessToken,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to list OAuth applications: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const apps = (await response.json()) as GitLabOAuthAppResponse[];
      console.log(`[GITLAB] Found ${apps.length} OAuth applications`);
      return apps.map((app: GitLabOAuthAppResponse) => ({
        id: app.id,
        application_id: app.application_id,
        application_name: app.application_name,
        secret: app.secret,
        callback_url: app.callback_url,
        scopes: app.scopes || [],
      }));
    } catch (error) {
      console.error("[GITLAB] Failed to list OAuth applications:", error);
      throw error;
    }
  }
}
