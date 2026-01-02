import { APIRequestContext, APIResponse, request } from "@playwright/test";
import * as crypto from "crypto";
import playwrightConfig from "../../../playwright.config";

export class GitHubEventsHelper {
  private readonly eventsUrl: string;
  private readonly webhookSecret: string;
  private myContext: APIRequestContext;

  private constructor() {
    this.eventsUrl = `${playwrightConfig.use.baseURL}/api/events/http/github`;
    this.webhookSecret =
      process.env.GITHUB_WEBHOOK_SECRET ||
      process.env.GITHUB_APP_WEBHOOK_SECRET ||
      "";
  }

  public static async build(): Promise<GitHubEventsHelper> {
    const instance = new GitHubEventsHelper();
    instance.myContext = await request.newContext({
      ignoreHTTPSErrors: true,
    });
    return instance;
  }

  // Send webhook payload with proper GitHub signature
  public async sendWebhookEvent(
    eventType: string,
    payload: any,
  ): Promise<APIResponse> {
    const payloadString = JSON.stringify(payload);
    const signature = this.calculateSignature(payloadString);

    return await this.myContext.post(this.eventsUrl, {
      data: payloadString,
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "User-Agent": "GitHub-Hookshot/test",
        "X-GitHub-Delivery": crypto.randomUUID(),
        "X-GitHub-Event": eventType,
        "X-Hub-Signature-256": signature,
      },
    });
  }

  private calculateSignature(payload: string): string {
    const hmac = crypto.createHmac("sha256", this.webhookSecret);
    hmac.update(payload);
    return `sha256=${hmac.digest("hex")}`;
  }

  public async sendPushEvent(
    repo: string,
    catalogAction: "added" | "modified" | "removed" = "modified",
  ): Promise<APIResponse> {
    const payload = this.createPushPayload(repo, catalogAction);
    return await this.sendWebhookEvent("push", payload);
  }

  public async sendTeamEvent(
    action: "created" | "deleted",
    teamName: string,
    orgName: string,
  ): Promise<APIResponse> {
    const payload = this.createTeamPayload(action, teamName, orgName);
    return await this.sendWebhookEvent("team", payload);
  }

  public async sendMembershipEvent(
    action: "added" | "removed",
    username: string,
    teamName: string,
    orgName: string,
  ): Promise<APIResponse> {
    const payload = this.createMembershipPayload(
      action,
      username,
      teamName,
      orgName,
    );
    return await this.sendWebhookEvent("membership", payload);
  }

  public async sendOrganizationEvent(
    action: "member_added" | "member_removed",
    username: string,
    orgName: string,
  ): Promise<APIResponse> {
    const payload = this.createOrganizationPayload(action, username, orgName);
    return await this.sendWebhookEvent("organization", payload);
  }

  private createPushPayload(
    repo: string,
    catalogAction: "added" | "modified" | "removed" = "modified",
  ): any {
    const [owner, repoName] = repo.split("/");

    // Determine which array gets catalog-info.yaml based on action
    const catalogFile = "catalog-info.yaml";
    const commitFiles = {
      added: catalogAction === "added" ? [catalogFile] : [],
      removed: catalogAction === "removed" ? [catalogFile] : [],
      modified: catalogAction === "modified" ? [catalogFile] : [],
    };

    // Update commit message based on action
    const commitMessages = {
      added: "Add catalog-info.yaml",
      modified: "Update catalog-info.yaml",
      removed: "Remove catalog-info.yaml",
    };

    return {
      ref: "refs/heads/main",
      before: "0000000000000000000000000000000000000000",
      after: crypto.randomUUID().substring(0, 40).replace(/-/g, "0"),
      repository: {
        id: Math.floor(Math.random() * 1000000),
        node_id: "R_" + crypto.randomUUID().substring(0, 20),
        name: repoName,
        full_name: repo,
        private: false,
        owner: {
          name: owner,
          login: owner,
          id: Math.floor(Math.random() * 100000),
          node_id: "U_" + crypto.randomUUID().substring(0, 20),
          avatar_url: `https://avatars.githubusercontent.com/u/${Math.floor(Math.random() * 100000)}`,
          type: "Organization",
        },
        html_url: `https://github.com/${repo}`,
        description: `Test repository ${repoName}`,
        url: `https://api.github.com/repos/${repo}`,
        default_branch: "main",
        topics: [],
        archived: false,
        fork: false,
        visibility: "public",
      },
      pusher: {
        name: "test-user",
        email: "test@example.com",
      },
      organization: {
        login: owner,
        id: Math.floor(Math.random() * 100000),
        node_id: "O_" + crypto.randomUUID().substring(0, 20),
        url: `https://api.github.com/orgs/${owner}`,
        avatar_url: `https://avatars.githubusercontent.com/u/${Math.floor(Math.random() * 100000)}`,
      },
      sender: {
        login: "test-user",
        id: Math.floor(Math.random() * 100000),
        type: "User",
      },
      created: catalogAction === "added",
      deleted: catalogAction === "removed",
      forced: false,
      base_ref: null,
      compare: `https://github.com/${repo}/commit/${crypto.randomUUID().substring(0, 12).replace(/-/g, "0")}`,
      commits: [
        {
          id: crypto.randomUUID().substring(0, 40).replace(/-/g, "0"),
          tree_id: crypto.randomUUID().substring(0, 40).replace(/-/g, "0"),
          distinct: true,
          message: commitMessages[catalogAction],
          timestamp: new Date().toISOString(),
          url: `https://github.com/${repo}/commit/${crypto.randomUUID().substring(0, 40).replace(/-/g, "0")}`,
          author: {
            name: "Test User",
            email: "test@example.com",
            date: new Date().toISOString(),
            username: "test-user",
          },
          committer: {
            name: "GitHub",
            email: "noreply@github.com",
            date: new Date().toISOString(),
            username: "web-flow",
          },
          added: commitFiles.added,
          removed: commitFiles.removed,
          modified: commitFiles.modified,
        },
      ],
      head_commit: {
        id: crypto.randomUUID().substring(0, 40).replace(/-/g, "0"),
        tree_id: crypto.randomUUID().substring(0, 40).replace(/-/g, "0"),
        distinct: true,
        message: commitMessages[catalogAction],
        timestamp: new Date().toISOString(),
        url: `https://github.com/${repo}/commit/${crypto.randomUUID().substring(0, 40).replace(/-/g, "0")}`,
        author: {
          name: "Test User",
          email: "test@example.com",
          date: new Date().toISOString(),
          username: "test-user",
        },
        committer: {
          name: "GitHub",
          email: "noreply@github.com",
          date: new Date().toISOString(),
          username: "web-flow",
        },
        added: commitFiles.added,
        removed: commitFiles.removed,
        modified: commitFiles.modified,
      },
    };
  }

  private createTeamPayload(
    action: string,
    teamName: string,
    orgName: string,
  ): any {
    const slug = teamName.toLowerCase().replace(/\s+/g, "-");
    const orgId = Math.floor(Math.random() * 1000000);
    const teamId = Math.floor(Math.random() * 100000000);
    return {
      action,
      team: {
        name: teamName,
        id: teamId,
        node_id: "T_" + crypto.randomUUID().substring(0, 20),
        slug: slug,
        description: "",
        privacy: "closed",
        notification_setting: "notifications_enabled",
        url: `https://api.github.com/organizations/${orgId}/team/${teamId}`,
        html_url: `https://github.com/orgs/${orgName}/teams/${slug}`,
        members_url: `https://api.github.com/organizations/${orgId}/team/${teamId}/members{/member}`,
        repositories_url: `https://api.github.com/organizations/${orgId}/team/${teamId}/repos`,
        type: "organization",
        organization_id: orgId,
        permission: "pull",
        parent: null,
      },
      organization: {
        login: orgName,
        id: orgId,
        node_id: "O_" + crypto.randomUUID().substring(0, 20),
        url: `https://api.github.com/orgs/${orgName}`,
        repos_url: `https://api.github.com/orgs/${orgName}/repos`,
        events_url: `https://api.github.com/orgs/${orgName}/events`,
        hooks_url: `https://api.github.com/orgs/${orgName}/hooks`,
        issues_url: `https://api.github.com/orgs/${orgName}/issues`,
        members_url: `https://api.github.com/orgs/${orgName}/members{/member}`,
        public_members_url: `https://api.github.com/orgs/${orgName}/public_members{/member}`,
        avatar_url: `https://avatars.githubusercontent.com/u/${orgId}?v=4`,
        description: null,
      },
      sender: {
        login: "test-user",
        id: Math.floor(Math.random() * 100000),
        node_id: "U_" + crypto.randomUUID().substring(0, 20),
        avatar_url: `https://avatars.githubusercontent.com/u/${Math.floor(Math.random() * 100000)}?v=4`,
        gravatar_id: "",
        url: `https://api.github.com/users/test-user`,
        html_url: `https://github.com/test-user`,
        type: "User",
        user_view_type: "public",
        site_admin: false,
      },
    };
  }

  private createMembershipPayload(
    action: string,
    username: string,
    teamName: string,
    orgName: string,
  ): any {
    const teamSlug = teamName.toLowerCase().replace(/\s+/g, "-");
    const orgId = Math.floor(Math.random() * 1000000);
    const teamId = Math.floor(Math.random() * 100000000);
    const userId = Math.floor(Math.random() * 1000000);
    return {
      action,
      scope: "team",
      member: {
        login: username,
        id: userId,
        node_id: "U_" + crypto.randomUUID().substring(0, 20),
        avatar_url: `https://avatars.githubusercontent.com/u/${userId}?v=4`,
        gravatar_id: "",
        url: `https://api.github.com/users/${username}`,
        html_url: `https://github.com/${username}`,
        followers_url: `https://api.github.com/users/${username}/followers`,
        following_url: `https://api.github.com/users/${username}/following{/other_user}`,
        gists_url: `https://api.github.com/users/${username}/gists{/gist_id}`,
        starred_url: `https://api.github.com/users/${username}/starred{/owner}{/repo}`,
        subscriptions_url: `https://api.github.com/users/${username}/subscriptions`,
        organizations_url: `https://api.github.com/users/${username}/orgs`,
        repos_url: `https://api.github.com/users/${username}/repos`,
        events_url: `https://api.github.com/users/${username}/events{/privacy}`,
        received_events_url: `https://api.github.com/users/${username}/received_events`,
        type: "User",
        user_view_type: "public",
        site_admin: false,
      },
      sender: {
        login: "test-admin",
        id: Math.floor(Math.random() * 100000),
        node_id: "U_" + crypto.randomUUID().substring(0, 20),
        avatar_url: `https://avatars.githubusercontent.com/u/${Math.floor(Math.random() * 100000)}?v=4`,
        gravatar_id: "",
        url: `https://api.github.com/users/test-admin`,
        html_url: `https://github.com/test-admin`,
        type: "User",
        user_view_type: "public",
        site_admin: false,
      },
      team: {
        name: teamName,
        id: teamId,
        node_id: "T_" + crypto.randomUUID().substring(0, 20),
        slug: teamSlug,
        description: "",
        privacy: "closed",
        notification_setting: "notifications_enabled",
        url: `https://api.github.com/organizations/${orgId}/team/${teamId}`,
        html_url: `https://github.com/orgs/${orgName}/teams/${teamSlug}`,
        members_url: `https://api.github.com/organizations/${orgId}/team/${teamId}/members{/member}`,
        repositories_url: `https://api.github.com/organizations/${orgId}/team/${teamId}/repos`,
        type: "organization",
        organization_id: orgId,
        permission: "pull",
        parent: null,
      },
      organization: {
        login: orgName,
        id: orgId,
        node_id: "O_" + crypto.randomUUID().substring(0, 20),
        url: `https://api.github.com/orgs/${orgName}`,
        repos_url: `https://api.github.com/orgs/${orgName}/repos`,
        events_url: `https://api.github.com/orgs/${orgName}/events`,
        hooks_url: `https://api.github.com/orgs/${orgName}/hooks`,
        issues_url: `https://api.github.com/orgs/${orgName}/issues`,
        members_url: `https://api.github.com/orgs/${orgName}/members{/member}`,
        public_members_url: `https://api.github.com/orgs/${orgName}/public_members{/member}`,
        avatar_url: `https://avatars.githubusercontent.com/u/${orgId}?v=4`,
        description: null,
      },
    };
  }

  private createOrganizationPayload(
    action: string,
    username: string,
    orgName: string,
  ): any {
    const orgId = Math.floor(Math.random() * 1000000);
    const userId = Math.floor(Math.random() * 1000000);
    return {
      action,
      membership: {
        url: `https://api.github.com/orgs/${orgName}/memberships/${username}`,
        state: action === "member_added" ? "active" : "inactive",
        role: action === "member_added" ? "member" : "unaffiliated",
        organization_url: `https://api.github.com/orgs/${orgName}`,
        user: {
          login: username,
          id: userId,
          node_id: "U_" + crypto.randomUUID().substring(0, 20),
          avatar_url: `https://avatars.githubusercontent.com/u/${userId}?v=4`,
          gravatar_id: "",
          url: `https://api.github.com/users/${username}`,
          html_url: `https://github.com/${username}`,
          followers_url: `https://api.github.com/users/${username}/followers`,
          following_url: `https://api.github.com/users/${username}/following{/other_user}`,
          gists_url: `https://api.github.com/users/${username}/gists{/gist_id}`,
          starred_url: `https://api.github.com/users/${username}/starred{/owner}{/repo}`,
          subscriptions_url: `https://api.github.com/users/${username}/subscriptions`,
          organizations_url: `https://api.github.com/users/${username}/orgs`,
          repos_url: `https://api.github.com/users/${username}/repos`,
          events_url: `https://api.github.com/users/${username}/events{/privacy}`,
          received_events_url: `https://api.github.com/users/${username}/received_events`,
          type: "User",
          user_view_type: "public",
          site_admin: false,
        },
        direct_membership: action === "member_added",
        enterprise_teams_providing_indirect_membership: [],
      },
      organization: {
        login: orgName,
        id: orgId,
        node_id: "O_" + crypto.randomUUID().substring(0, 20),
        url: `https://api.github.com/orgs/${orgName}`,
        repos_url: `https://api.github.com/orgs/${orgName}/repos`,
        events_url: `https://api.github.com/orgs/${orgName}/events`,
        hooks_url: `https://api.github.com/orgs/${orgName}/hooks`,
        issues_url: `https://api.github.com/orgs/${orgName}/issues`,
        members_url: `https://api.github.com/orgs/${orgName}/members{/member}`,
        public_members_url: `https://api.github.com/orgs/${orgName}/public_members{/member}`,
        avatar_url: `https://avatars.githubusercontent.com/u/${orgId}?v=4`,
        description: null,
      },
      sender: {
        login: "test-admin",
        id: Math.floor(Math.random() * 100000),
        node_id: "U_" + crypto.randomUUID().substring(0, 20),
        avatar_url: `https://avatars.githubusercontent.com/u/${Math.floor(Math.random() * 100000)}?v=4`,
        gravatar_id: "",
        url: `https://api.github.com/users/test-admin`,
        html_url: `https://github.com/test-admin`,
        type: "User",
        user_view_type: "public",
        site_admin: false,
      },
    };
  }
}
