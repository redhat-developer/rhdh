import { request, test, expect, Page } from "@playwright/test";
import { Common, setupBrowser } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { APIHelper } from "../utils/api-helper";
import { GitHubEventsHelper } from "../support/api/github-events";
import * as crypto from "crypto";

let page: Page;

test.describe("GitHub Events Module", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let githubEventsHelper: GitHubEventsHelper;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "integration",
    });

    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UIhelper(page);
    githubEventsHelper = await GitHubEventsHelper.build();
    await common.loginAsGuest();
  });

  test("Events endpoint accepts signed GitHub webhook payloads", async () => {
    const rawBody = JSON.stringify({
      zen: "Test Payload.",
      hook_id: 123456,
      repository: {
        full_name: "test/repo",
      },
      organization: {
        login: "test-org",
      },
    });

    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET!;
    const signature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

    const context = await request.newContext();

    const response = await context.post("/api/events/http/github", {
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "ping",
        "X-GitHub-Delivery": "test-delivery-id",
        "X-Hub-Signature-256": signature,
      },
      data: rawBody,
    });

    expect(response.status()).toBe(202);
  });

  test.describe("GitHub Discovery", () => {
    const catalogRepoName = `janus-test-github-events-test-${Date.now()}`;
    const catalogRepoDetails = {
      name: catalogRepoName,
      url: `github.com/${process.env.GITHUB_EVENTS_ORG}/${catalogRepoName}`,
      org: `github.com/${process.env.GITHUB_EVENTS_ORG}`,
      owner: process.env.GITHUB_EVENTS_ORG,
    };
    test("Adding a new entity to the catalog", async () => {
      const catalogInfoYamlContent = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${catalogRepoName}
  annotations:
    github.com/project-slug: ${process.env.GITHUB_EVENTS_ORG}/${catalogRepoName}
  description: E2E test component for github events module
spec:
  type: other
  lifecycle: unknown
  owner: user:default/rhdh-qe-user`;

      await APIHelper.createGitHubRepoWithFile(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "catalog-info.yaml",
        catalogInfoYamlContent,
      );

      await githubEventsHelper.sendPushEvent(
        `${process.env.GITHUB_EVENTS_ORG}/${catalogRepoName}`,
        "added",
      );

      await page.waitForTimeout(10000);
      await page.reload();
      await page.waitForTimeout(10000);
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder(catalogRepoName);
      await expect(
        page.getByRole("link", { name: catalogRepoName }),
      ).toBeVisible({
        timeout: 15000,
      });
    });

    test("Updating an entity in the catalog", async () => {
      const updatedDescription = "updated description";
      const updatedCatalogInfoYaml = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${catalogRepoName}
  annotations:
    github.com/project-slug: ${process.env.GITHUB_EVENTS_ORG}/${catalogRepoName}
  description: ${updatedDescription}
spec:
  type: other
  lifecycle: unknown
  owner: user:default/rhdh-qe-user`;
      await APIHelper.updateFileInRepo(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "catalog-info.yaml",
        updatedCatalogInfoYaml,
        "Update catalog-info.yaml description",
      );
      await githubEventsHelper.sendPushEvent(
        `${process.env.GITHUB_EVENTS_ORG}/${catalogRepoName}`,
        "modified",
      );
      await page.waitForTimeout(10000);
      await page.reload();
      await page.waitForTimeout(10000);
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder(catalogRepoName);
      await page.getByRole("link", { name: catalogRepoName }).click();
      await expect(page.getByText(updatedDescription)).toBeVisible({
        timeout: 15000,
      });
    });

    test("Deleting an entity from the catalog", async () => {
      await APIHelper.deleteFileInRepo(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "catalog-info.yaml",
        "Remove catalog-info.yaml",
      );
      await githubEventsHelper.sendPushEvent(
        `${process.env.GITHUB_EVENTS_ORG}/${catalogRepoName}`,
        "removed",
      );
      await page.waitForTimeout(10000);
      await page.reload();
      await page.waitForTimeout(10000);
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder(catalogRepoName);
      await expect(
        page.getByRole("link", { name: catalogRepoName }),
      ).not.toBeVisible({
        timeout: 15000,
      });
    });
  });

  test.describe("GitHub Organizational Data", () => {
    test.describe("Teams", () => {
      const teamName = "test-team-" + Date.now();

      test("Adding a new group", async () => {
        await APIHelper.createTeamInOrg(
          process.env.GITHUB_EVENTS_ORG,
          teamName,
        );
        await githubEventsHelper.sendTeamEvent(
          "created",
          teamName,
          process.env.GITHUB_EVENTS_ORG,
        );

        await page.waitForTimeout(10000);
        await uiHelper.openSidebar("Catalog");
        await uiHelper.selectMuiBox("Kind", "Group");
        await uiHelper.searchInputPlaceholder(teamName);

        await expect(page.getByRole("link", { name: teamName })).toBeVisible({
          timeout: 15000,
        });
      });

      test("Deleting a group", async () => {
        await APIHelper.deleteTeamFromOrg(
          process.env.GITHUB_EVENTS_ORG,
          teamName,
        );

        await githubEventsHelper.sendTeamEvent(
          "deleted",
          teamName,
          process.env.GITHUB_EVENTS_ORG,
        );
        await page.waitForTimeout(10000);
        await page.reload();
        await page.waitForTimeout(10000);
        await uiHelper.openSidebar("Catalog");
        await uiHelper.selectMuiBox("Kind", "Group");
        await uiHelper.searchInputPlaceholder(teamName);

        await expect(
          page.getByRole("link", { name: teamName }),
        ).not.toBeVisible({
          timeout: 15000,
        });
      });
    });

    test.describe("Team Membership", () => {
      let teamCreated = false;
      let userAddedToTeam = false;
      const teamName = "test-team-" + Date.now();

      test.beforeEach(async () => {
        await APIHelper.createTeamInOrg(
          process.env.GITHUB_EVENTS_ORG,
          teamName,
        );
        teamCreated = true;

        await APIHelper.addUserToTeam(
          process.env.GITHUB_EVENTS_ORG,
          teamName,
          process.env.GITHUB_EVENTS_TEST_USER,
        );
        userAddedToTeam = true;
      });

      test.afterEach(async () => {
        if (userAddedToTeam) {
          await APIHelper.removeUserFromTeam(
            process.env.GITHUB_EVENTS_ORG,
            teamName,
            process.env.GITHUB_EVENTS_TEST_USER,
          );
          userAddedToTeam = false;
        }

        if (teamCreated) {
          await APIHelper.deleteTeamFromOrg(
            process.env.GITHUB_EVENTS_ORG,
            teamName,
          );
          teamCreated = false;
        }
      });

      test("Adding a user to a group", async () => {
        await githubEventsHelper.sendMembershipEvent(
          "added",
          process.env.GITHUB_EVENTS_TEST_USER,
          teamName,
          process.env.GITHUB_EVENTS_ORG,
        );

        await page.waitForTimeout(10000);

        const api = new APIHelper();
        await api.UseStaticToken(process.env.BACKEND_AUTH_SECRET);
        await api.UseBaseUrl(process.env.BASE_URL);

        const groupEntity = await api.getGroupEntityFromAPI(teamName);
        const members =
          groupEntity.relations
            ?.filter((r) => r.type === "hasMember")
            .map((r) => r.targetRef.split("/")[1]) || [];

        expect(members).toContain("maryamtaj");
      });

      test("Removing a user from a group", async () => {
        // Step 1: Remove user from the team
        await APIHelper.removeUserFromTeam(
          process.env.GITHUB_EVENTS_ORG,
          teamName,
          process.env.GITHUB_EVENTS_TEST_USER,
        );
        userAddedToTeam = false;

        await githubEventsHelper.sendMembershipEvent(
          "removed",
          process.env.GITHUB_EVENTS_TEST_USER,
          teamName,
          process.env.GITHUB_EVENTS_ORG,
        );

        await page.waitForTimeout(10000);

        const api = new APIHelper();
        await api.UseStaticToken(process.env.BACKEND_AUTH_SECRET);
        await api.UseBaseUrl(process.env.BASE_URL);

        const groupEntity = await api.getGroupEntityFromAPI(teamName);
        const members =
          groupEntity.relations
            ?.filter((r) => r.type === "hasMember")
            .map((r) => r.targetRef.split("/")[1]) || [];

        expect(members).not.toContain("maryamtaj");
      });
    });
  });
});
