import { test, expect, Page } from "@playwright/test";
import { Common, setupBrowser } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { APIHelper } from "../utils/api-helper";
import { GitHubEventsHelper } from "../support/api/github-events";

let page: Page;

test.describe("GitHub Events Module", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let eventsHelper: GitHubEventsHelper;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "integration",
    });

    page = (await setupBrowser(browser, testInfo)).page;
    common = new Common(page);
    uiHelper = new UIhelper(page);
    eventsHelper = await GitHubEventsHelper.build();

    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
  });

  test.describe("GitHub Discovery", () => {
    let catalogRepoName: string;
    let catalogRepoDetails: {
      name: string;
      url: string;
      org: string;
      owner: string;
    };

    test.beforeEach(async () => {
      // Before Test: Create a real GitHub repository with catalog-info.yaml
      catalogRepoName = `janus-test-github-events-test-${Date.now()}`;
      catalogRepoDetails = {
        name: catalogRepoName,
        url: `github.com/janus-test/${catalogRepoName}`,
        org: "github.com/janus-test",
        owner: "janus-test",
      };

      const catalogInfoYamlContent = `apiVersion: backstage.io/v1alpha1
    kind: Component
    metadata:
      name: ${catalogRepoName}
      annotations:
        github.com/project-slug: janus-test/${catalogRepoName}
      description: E2E test component for github events module
    spec:
      type: other
      lifecycle: unknown
      owner: user:default/rhdh-qe-2`;

      await APIHelper.createGitHubRepoWithFile(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "catalog-info.yaml",
        catalogInfoYamlContent,
      );
    });

    test.afterEach(async () => {
      await APIHelper.deleteGitHubRepo(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
      );
    });

    test("Adding a new entity to the catalog", async () => {
      // Step 2: Send webhook event for this repository
      await eventsHelper.sendPushEvent(catalogRepoName, "added");

      // Step 3: Wait for catalog processing and navigate to catalog
      await page.waitForTimeout(10000); // 10 seconds for catalog processing
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      // Step 4: Search and verify entity appears in catalog
      await uiHelper.searchInputPlaceholder(catalogRepoName);
      await expect(
        page.getByRole("link", { name: catalogRepoName }),
      ).toBeVisible({
        timeout: 15000,
      });
    });

    test("Updating an entity in the catalog", async () => {
      // Step 1: Update the catalog-info.yaml file
      const updatedDescription = "updated description";
      const updatedCatalogInfoYaml = `apiVersion: backstage.io/v1alpha1
      kind: Component
      metadata:
        name: ${catalogRepoName}
        annotations:
          github.com/project-slug: janus-test/${catalogRepoName}
        description: ${updatedDescription}
      spec:
        type: other
        lifecycle: unknown
        owner: user:default/rhdh-qe-2`;
      await APIHelper.updateFileInRepo(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "catalog-info.yaml",
        updatedCatalogInfoYaml,
        "Update catalog-info.yaml description",
      );
      // Step 2: Send push event with modified catalog-info.yaml
      await eventsHelper.sendPushEvent(catalogRepoName, "modified");
      // Step 3: Wait for catalog processing and navigate to catalog
      await page.waitForTimeout(10000); // 10 seconds for catalog processing
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      // Step 4: Search and verify the description of the entity is updated
      await uiHelper.searchInputPlaceholder(catalogRepoName);
      await page.getByRole("link", { name: catalogRepoName }).click();
      await expect(page.getByText(updatedDescription)).toBeVisible({
        timeout: 15000,
      });
    });

    test("Deleting an entity from the catalog", async () => {
      // Step 1: Delete the catalog-info.yaml file
      await APIHelper.deleteFileInRepo(
        catalogRepoDetails.owner,
        catalogRepoDetails.name,
        "catalog-info.yaml",
        "Remove catalog-info.yaml",
      );
      // Step 2: Send push event removing catalog-info.yaml
      await eventsHelper.sendPushEvent(catalogRepoName, "removed");
      // Step 3: Wait for catalog processing and navigate to catalog
      await page.waitForTimeout(10000); // 10 seconds for catalog processing
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");
      // Step 4: Search and verify the entity is deleted
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
      let teamCreated = false;

      test.beforeEach(async () => {
        await APIHelper.createTeamInOrg("janus-test", "test-team");
        teamCreated = true;
      });

      test.afterEach(async () => {
        if (teamCreated) {
          await APIHelper.deleteTeamFromOrg("janus-test", "test-team");
          teamCreated = false;
        }
      });

      test("Adding a new group", async () => {
        // Step 1: Send team created payload
        await eventsHelper.sendTeamEvent("created", "test-team", "janus-test");

        // Step 2: Wait for catalog processing and navigate to catalog
        await page.waitForTimeout(10000);
        await uiHelper.openSidebar("Catalog");
        await uiHelper.selectMuiBox("Kind", "Group");
        await uiHelper.searchInputPlaceholder("test-team");

        // Step 3: Verify team appears in catalog
        await expect(page.getByRole("link", { name: "test-team" })).toBeVisible(
          {
            timeout: 15000,
          },
        );
      });

      test("Deleting a group", async () => {
        // Step 1: Delete the team from GitHub
        await APIHelper.deleteTeamFromOrg("janus-test", "test-team");
        teamCreated = false;

        // Step 2: Send team deleted payload
        await eventsHelper.sendTeamEvent("deleted", "test-team", "janus-test");

        // Step 3: Wait for catalog processing and navigate to catalog
        await page.waitForTimeout(10000);
        await uiHelper.openSidebar("Catalog");
        await uiHelper.selectMuiBox("Kind", "Group");
        await uiHelper.searchInputPlaceholder("test-team");

        // Step 4: Verify team is removed from catalog
        await expect(
          page.getByRole("link", { name: "test-team" }),
        ).not.toBeVisible({
          timeout: 15000,
        });
      });
    });

    test.describe("Team Membership", () => {
      let teamCreated = false;
      let userAddedToTeam = false;

      test.beforeEach(async () => {
        await APIHelper.createTeamInOrg("janus-test", "test-team");
        teamCreated = true;

        await APIHelper.addUserToTeam("janus-test", "test-team", "test-user");
        userAddedToTeam = true;
      });

      test.afterEach(async () => {
        if (userAddedToTeam) {
            await APIHelper.removeUserFromTeam(
              "janus-test",
              "test-team",
              "test-user",
            );
          userAddedToTeam = false;
        }

        if (teamCreated) {
          await APIHelper.deleteTeamFromOrg("janus-test", "test-team");
          teamCreated = false;
        }
      });

      test("Adding a user to a group", async () => {
        // Step 1: Send membership added payload
        await eventsHelper.sendMembershipEvent(
          "added",
          "test-user",
          "test-team",
          "janus-test",
        );

        // Step 2: Wait for catalog processing
        await page.waitForTimeout(10000);

        // Step 3: Verify via catalog API
        const api = new APIHelper();
        await api.UseStaticToken(process.env.BACKEND_AUTH_SECRET);
        await api.UseBaseUrl(process.env.BASE_URL);

        const groupEntity = await api.getGroupEntityFromAPI("test-team");
        const members =
          groupEntity.relations
            ?.filter((r) => r.type === "hasMember")
            .map((r) => r.targetRef.split("/")[1]) || [];

        expect(members).toContain("test-user");
      });

      test("Removing a user from a group", async () => {
        // Step 1: Remove user from the team
        await APIHelper.removeUserFromTeam(
          "janus-test",
          "test-team",
          "test-user",
        );
        userAddedToTeam = false;

        // Step 2: Send membership removed payload
        await eventsHelper.sendMembershipEvent(
          "removed",
          "test-user",
          "test-team",
          "janus-test",
        );

        // Step 3: Wait for catalog processing
        await page.waitForTimeout(10000);

        // Step 4: Verify via catalog API
        const api = new APIHelper();
        await api.UseStaticToken(process.env.BACKEND_AUTH_SECRET);
        await api.UseBaseUrl(process.env.BASE_URL);

        const groupEntity = await api.getGroupEntityFromAPI("test-team");
        const members =
          groupEntity.relations
            ?.filter((r) => r.type === "hasMember")
            .map((r) => r.targetRef.split("/")[1]) || [];

        expect(members).not.toContain("test-user");
      });
    });

    test.describe("Organization Membership", () => {
      let userAddedToOrg = false;

      test.beforeEach(async () => {
        await APIHelper.addUserToOrg("janus-test", "test-user");
        userAddedToOrg = true;
      });

      test.afterEach(async () => {
        if (userAddedToOrg) {
          await APIHelper.removeUserFromOrg("janus-test", "test-user");
          userAddedToOrg = false;
        }
      });

      test("Adding a user to the org", async () => {
        // Step 1: Send organization member added payload
        await eventsHelper.sendOrganizationEvent(
          "member_added",
          "test-user",
          "janus-test",
        );

        // Step 2: Wait for catalog processing and navigate to catalog
        await page.waitForTimeout(10000);
        await uiHelper.openSidebar("Catalog");
        await uiHelper.selectMuiBox("Kind", "User");
        await uiHelper.searchInputPlaceholder("test-user");

        // Step 3: Verify user appears in catalog
        await expect(page.getByRole("link", { name: "test-user" })).toBeVisible(
          {
            timeout: 15000,
          },
        );
      });

      test("Removing a user from the org", async () => {
        // Step 1: Remove user from the organization
        await APIHelper.removeUserFromOrg("janus-test", "test-user");
        userAddedToOrg = false; // Mark as removed

        // Step 2: Send organization member removed payload
        await eventsHelper.sendOrganizationEvent(
          "member_removed",
          "test-user",
          "janus-test",
        );

        // Step 3: Wait for catalog processing and navigate to catalog
        await page.waitForTimeout(10000);
        await uiHelper.openSidebar("Catalog");
        await uiHelper.selectMuiBox("Kind", "User");
        await uiHelper.searchInputPlaceholder("test-user");

        // Step 4: Verify user is removed from catalog
        await expect(
          page.getByRole("link", { name: "test-user" }),
        ).not.toBeVisible({
          timeout: 15000,
        });
      });
    });
  });
});
