import { Locator, Page, expect, test } from "@playwright/test";
import { Response, Roles } from "../../../support/pages/rbac";
import { UI_HELPER_ELEMENTS } from "../../../support/pageObjects/global-obj";
import {
  HOME_PAGE_COMPONENTS,
  ROLE_OVERVIEW_COMPONENTS,
  ROLES_PAGE_COMPONENTS,
} from "../../../support/pageObjects/page-obj";
import { Common, setupBrowser } from "../../../utils/common";
import { UiHelper } from "../../../utils/ui-helper";
import fs from "fs/promises";
import { RbacPo } from "../../../support/pageObjects/rbac-po";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../../support/api/rbac-api";
import { RbacConstants } from "../../../data/rbac-constants";
import { Policy } from "../../../support/api/rbac-api-structures";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { LOGGER } from "../../../utils/logger";

/*
    Note that:
    The policies generated from a policy.csv or ConfigMap file cannot be edited or deleted using the Developer Hub Web UI.
    https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.3/html/authorization/managing-authorizations-by-using-the-web-ui#proc-rbac-ui-edit-role_title-authorization
*/
test.describe.skip("Test RBAC", () => {
  test.describe
    .serial("Test RBAC plugin: load permission policies and conditions from files", () => {
    test.beforeEach(async ({ page }) => {
      await new Common(page).loginAsKeycloakUser();
      await page.goto("/rbac");
    });

    test("Check UI navigation by nav bar when RBAC is enabled", async ({
      page,
    }) => {
      await page.goto("/");
      const uiHelper = new UiHelper(page);
      await uiHelper.openSidebarButton("Administration");
      const dropdownMenuLocator = page.locator(`text="RBAC"`);
      await expect(dropdownMenuLocator).toBeVisible();
      await dropdownMenuLocator.click();
      await uiHelper.verifyHeading("RBAC");
      expect(await page.title()).toContain("RBAC");
    });

    test("Check if permission policies defined in files are loaded", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);

      const testRole: string = "role:default/test2-role";

      await uiHelper.verifyHeading(/All roles \(\d+\)/);
      await uiHelper.verifyLink(testRole);
      await uiHelper.clickLink(testRole);

      await uiHelper.verifyHeading(testRole);
      await uiHelper.clickTab("Overview");

      await uiHelper.verifyText("About");
      await uiHelper.verifyText("csv permission policy file");

      await uiHelper.verifyHeading("Users and groups (1 group");
      await uiHelper.verifyHeading("Permission policies (2)");
      const permissionPoliciesColumnsText =
        Roles.getPermissionPoliciesListColumnsText();
      await uiHelper.verifyColumnHeading(permissionPoliciesColumnsText);
      const permissionPoliciesCellsIdentifier =
        Roles.getPermissionPoliciesListCellsIdentifier();
      await uiHelper.verifyCellsInTable(permissionPoliciesCellsIdentifier);

      await expect(page.getByRole("article")).toContainText("catalog-entity");
      await expect(page.getByRole("article")).toContainText("Read, Update");
      await expect(page.getByRole("article")).toContainText("Delete");
    });
  });

  test.describe
    .serial("Test RBAC plugin: Aliases used in conditional access policies", () => {
    test.beforeEach(async ({ page }) => {
      await new Common(page).loginAsKeycloakUser(
        process.env.GH_USER2_ID,
        process.env.GH_USER2_PASS,
      );
    });

    test("Check if aliases used in conditions: the user is allowed to unregister only components they own, not those owned by the group.", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      const testUser = "test-rhdh-qe-2";
      await page.goto("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder(testUser);
      await page.getByRole("link", { name: testUser, exact: true }).click();

      await expect(page.locator("header")).toContainText(testUser);
      await page.getByTestId("menu-button").click();
      const unregisterUserOwned = page.getByText("Unregister entity");
      await expect(unregisterUserOwned).toBeEnabled();

      await page.getByText("Unregister entity").click();
      await expect(page.getByRole("heading")).toContainText(
        "Are you sure you want to unregister this entity?",
      );
      await page.getByRole("button", { name: "Cancel" }).click();

      await uiHelper.openSidebar("Catalog");
      await page
        .getByRole("link", { name: "test-rhdh-qe-2-team-owned" })
        .click();
      await expect(page.locator("header")).toContainText(
        "janus-qe/rhdh-qe-2-team",
      );
      await page.getByTestId("menu-button").click();
      const unregisterGroupOwned = page.getByText("Unregister entity");
      await expect(unregisterGroupOwned).toBeDisabled();
    });
  });

  test.describe("Test RBAC plugin as an admin user", () => {
    test.beforeEach(async ({ page }, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 30_000); // Additional time due to repeated timeout failure in OSD env.
      const common = new Common(page);
      await common.loginAsKeycloakUser();
      await page.goto("/rbac");
      await common.waitForLoad();
      await new UiHelper(page).verifyHeading("RBAC", 30_000);
    });

    test("Check if Administration side nav is present with RBAC plugin", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.verifyHeading(/All roles \(\d+\)/);
      const allGridColumnsText = Roles.getRolesListColumnsText();
      await uiHelper.verifyColumnHeading(allGridColumnsText);
      const allCellsIdentifier = Roles.getRolesListCellsIdentifier();
      await uiHelper.verifyCellsInTable(allCellsIdentifier);
    });

    test("Should download the user list", async ({ page }) => {
      await page.locator('a:has-text("Download User List")').click();
      const fileContent = await downloadAndReadFile(page);
      const lines = fileContent.trim().split("\n");

      const header = "userEntityRef,displayName,email,lastAuthTime";
      if (lines[0] !== header) {
        throw new Error("Header does not match");
      }

      // Check that each subsequent line starts with "user:default"
      const allUsersValid = lines
        .slice(1)
        .every((line) => line.startsWith("user:default"));
      if (!allUsersValid) {
        throw new Error("Not all users info are valid");
      }
    });

    async function downloadAndReadFile(
      page: Page,
    ): Promise<string | undefined> {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator('a:has-text("Download User List")').click(),
      ]);

      const filePath = await download.path();

      if (filePath) {
        const fileContent = await fs.readFile(filePath, "utf-8");
        return fileContent;
      } else {
        LOGGER.error("Download failed or path is not available");
        return undefined;
      }
    }

    test("View details of a role", async ({ page }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.clickLink("role:default/rbac_admin");

      await uiHelper.verifyHeading("role:default/rbac_admin");
      await uiHelper.clickTab("Overview");

      await uiHelper.verifyText("About");

      await uiHelper.verifyHeading("Users and groups (1 user");
      const usersAndGroupsColumnsText =
        Roles.getUsersAndGroupsListColumnsText();
      await uiHelper.verifyColumnHeading(usersAndGroupsColumnsText);
      const usersAndGroupsCellsIdentifier =
        Roles.getUsersAndGroupsListCellsIdentifier();
      await uiHelper.verifyCellsInTable(usersAndGroupsCellsIdentifier);

      await uiHelper.verifyHeading("Permission policies (5)");
      const permissionPoliciesColumnsText =
        Roles.getPermissionPoliciesListColumnsText();
      await uiHelper.verifyColumnHeading(permissionPoliciesColumnsText);
      const permissionPoliciesCellsIdentifier =
        Roles.getPermissionPoliciesListCellsIdentifier();
      await uiHelper.verifyCellsInTable(permissionPoliciesCellsIdentifier);

      await uiHelper.clickLink("RBAC");
    });

    test("Create and edit a role from the roles list page", async ({
      page,
    }) => {
      const rolesHelper = new Roles(page);
      const uiHelper = new UiHelper(page);

      const rbacPo = new RbacPo(page);
      const testUser = "Jonathon Page";
      await rbacPo.createRole("test-role", [
        RbacPo.rbacTestUsers.guest,
        RbacPo.rbacTestUsers.tara,
        RbacPo.rbacTestUsers.backstage,
      ]);
      await page.click(
        ROLES_PAGE_COMPONENTS.editRole("role:default/test-role"),
      );
      await uiHelper.verifyHeading("Edit Role");
      await uiHelper.clickButton("Next");
      await rbacPo.addUsersAndGroups(testUser);
      await page.click(rbacPo.selectMember(testUser));
      await uiHelper.verifyHeading("Users and groups (3 users, 1 group)");
      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role updated successfully",
      );

      await page
        .locator(HOME_PAGE_COMPONENTS.searchBar)
        .waitFor({ state: "visible" });
      await page.locator(HOME_PAGE_COMPONENTS.searchBar).fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");
      const usersAndGroupsLocator = page
        .locator(UI_HELPER_ELEMENTS.MuiTableCell)
        .filter({ hasText: "3 users, 1 group" });
      await usersAndGroupsLocator.waitFor();
      await expect(usersAndGroupsLocator).toBeVisible();

      await rolesHelper.deleteRole("role:default/test-role");
    });

    test("Edit users and groups and update policies of a role from the overview page", async ({
      page,
    }) => {
      const rolesHelper = new Roles(page);
      const uiHelper = new UiHelper(page);
      const rbacPo = new RbacPo(page);
      await rbacPo.createRole("test-role1", [
        RbacPo.rbacTestUsers.guest,
        RbacPo.rbacTestUsers.tara,
        RbacPo.rbacTestUsers.backstage,
      ]);

      await uiHelper.filterInputPlaceholder("test-role1");

      await uiHelper.clickLink("role:default/test-role1");

      await uiHelper.verifyHeading("role:default/test-role1");
      await uiHelper.clickTab("Overview");

      await page.click(ROLE_OVERVIEW_COMPONENTS.updateMembers);
      await uiHelper.verifyHeading("Edit Role");
      await page.locator(HOME_PAGE_COMPONENTS.searchBar).fill("Guest User");
      await page.click('button[aria-label="Remove"]');
      await uiHelper.verifyHeading("Users and groups (1 user, 1 group)");
      await uiHelper.clickByDataTestId("nextButton-1");
      await page.waitForSelector(".permission-policies-form", {
        state: "visible",
      });
      let nextButton2: Locator;
      let matchNextButton2: Locator[];
      let attempts = 0;
      do {
        await page.waitForTimeout(500);
        nextButton2 = page.locator('[data-testid="nextButton-2"]');
        matchNextButton2 = await nextButton2.all();
        attempts++;
      } while (matchNextButton2.length > 1 && attempts < 5);
      await nextButton2.click({
        force: true,
      });
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role1 updated successfully",
      );
      await uiHelper.verifyHeading("Users and groups (1 user, 1 group)");

      await page.click(ROLE_OVERVIEW_COMPONENTS.updatePolicies);
      await uiHelper.verifyHeading("Edit Role");
      await rbacPo.clickAddPermissionPolicy();
      await page.click(rbacPo.selectPermissionPolicyPlugin(1), {
        timeout: 10_000,
      });
      await rbacPo.selectOption("scaffolder");
      await page.click(rbacPo.selectPermissionPolicyPermission(1));
      await rbacPo.selectOption("scaffolder-template");
      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role1 updated successfully",
      );
      await uiHelper.verifyHeading("Permission Policies (3)");

      await rolesHelper.deleteRole("role:default/test-role1");
    });

    test("Create a role with a permission policy per resource type and verify that the only authorized users can access specific resources.", async ({
      page,
    }) => {
      const rolesHelper = new Roles(page);
      const uiHelper = new UiHelper(page);
      await new RbacPo(page).createRole(
        "test-role",
        ["Guest User", "rhdh-qe", "Backstage"],
        "anyOf",
      );

      await page
        .locator(HOME_PAGE_COMPONENTS.searchBar)
        .waitFor({ state: "visible" });
      await page.locator(HOME_PAGE_COMPONENTS.searchBar).fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");
      await rolesHelper.deleteRole("role:default/test-role");
    });
  });

  test.describe("Test RBAC plugin as a guest user", () => {
    test.beforeEach(async ({ page }) => {
      const common = new Common(page);
      await common.loginAsGuest();
    });

    test("Check if Administration side nav is present with no RBAC plugin", async ({
      page,
    }) => {
      const uiHelper = new UiHelper(page);
      await uiHelper.openSidebarButton("Administration");
      const dropdownMenuLocator = page.locator(`text="RBAC"`);
      await expect(dropdownMenuLocator).not.toBeVisible();
    });
  });

  test.describe.serial("Test RBAC API", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UiHelper;
    let page: Page;
    let apiToken: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UiHelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    // eslint-disable-next-line no-empty-pattern
    test.beforeEach(async ({}, testInfo) => {
      LOGGER.warning(
        `beforeEach: Attempting setup for ${testInfo.title}, retry: ${testInfo.retry}`,
      );
    });

    test("Test that roles and policies from GET request are what expected", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const rolesResponse = await rbacApi.getRoles();

      const policiesResponse = await rbacApi.getPolicies();

      if (!rolesResponse.ok()) {
        throw Error(
          `RBAC rolesResponse API call failed with status code ${rolesResponse.status()}`,
        );
      }

      if (!policiesResponse.ok()) {
        throw Error(
          `RBAC policiesResponse API call failed with status code ${policiesResponse.status()}`,
        );
      }

      await Response.checkResponse(
        rolesResponse,
        RbacConstants.getExpectedRoles(),
      );
      await Response.checkResponse(
        policiesResponse,
        RbacConstants.getExpectedPolicies(),
      );
    });

    test("Create new role for rhdh-qe, change its name, and deny it from reading catalog entities", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const members = ["user:default/rhdh-qe"];

      const newPolicy = {
        entityReference: "role:default/test",
        permission: "catalog-entity",
        policy: "read",
        effect: "deny",
      };

      const firstRole = {
        memberReferences: members,
        name: "role:default/admin",
      };

      const newRole = {
        memberReferences: members,
        name: "role:default/test",
      };

      const rolePostResponse = await rbacApi.createRoles(firstRole);

      const rolePutResponse = await rbacApi.updateRole(
        "default/admin",
        firstRole,
        newRole,
      );

      const policyPostResponse = await rbacApi.createPolicies([newPolicy]);

      expect(rolePostResponse.ok()).toBeTruthy();
      expect(rolePutResponse.ok()).toBeTruthy();
      expect(policyPostResponse.ok()).toBeTruthy();
    });

    test("Test catalog-entity read is denied", async ({ page }) => {
      await page.reload();
      await uiHelper.openSidebar("Catalog");
      await uiHelper.selectMuiBox("Kind", "Component");
      await uiHelper.verifyTableIsEmpty();
      await uiHelper.openSidebar("Create...");
      await page.reload();
      await uiHelper.verifyText(
        "No templates found that match your filter. Learn more about",
        false,
      );
    });

    test("Test catalog-entity refresh is denied", async () => {
      expect(
        await uiHelper.isBtnVisibleByTitle("Schedule entity refresh"),
      ).toBeFalsy();
    });

    test("Test catalog-entity create is allowed", async () => {
      await uiHelper.openSidebar("Create...");
      expect(await uiHelper.isLinkVisible("Register Existing Component"));
      await uiHelper.clickButton("Register Existing Component");
      const catalogImport = new CatalogImport(page);
      const component =
        "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";
      await catalogImport.registerExistingComponent(component);
    });

    test("Test bad PUT and PUT catalog-entity update policy", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const oldBadPolicy = [
        { permission: "catalog-entity", policy: "refresh", effect: "allow" },
      ];
      const newBadPolicy = [
        { permission: "catalog-entity", policy: "read", effect: "allow" },
      ];

      const oldGoodPolicy = [
        {
          permission: "catalog.entity.create",
          policy: "create",
          effect: "allow",
        },
      ];
      const newGoodPolicy = [
        {
          permission: "catalog.entity.refresh",
          policy: "update",
          effect: "allow",
        },
      ];

      const badPutResponse = await rbacApi.updatePolicy(
        "default/test",
        oldBadPolicy,
        newBadPolicy,
      );

      const goodPutResponse = await rbacApi.updatePolicy(
        "default/test",
        oldGoodPolicy,
        newGoodPolicy,
      );

      expect(badPutResponse.ok()).toBeFalsy();
      expect(goodPutResponse.ok());
    });

    test("DELETE catalog-entity update policy", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);
      const deletePolicies = [
        {
          entityReference: "role:default/test",
          permission: "catalog.entity.refresh",
          policy: "update",
          effect: "allow",
        },
      ];
      const deleteResponse = await rbacApi.deletePolicy(
        "default/test",
        deletePolicies,
      );

      expect(deleteResponse.ok());
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse =
          await rbacApi.getPolicy("default/test");

        const remainingPolicies = await Response.removeMetadataFromResponse(
          remainingPoliciesResponse,
        );

        const deleteRemainingPolicies = await rbacApi.deletePolicy(
          "default/test",
          remainingPolicies as Policy[],
        );

        const deleteRole = await rbacApi.deleteRole("default/test");

        expect(deleteRemainingPolicies.ok()).toBeTruthy();
        expect(deleteRole.ok()).toBeTruthy();
      } catch (error) {
        LOGGER.error("Error during cleanup in afterAll:", error);
      }
    });
  });
});
