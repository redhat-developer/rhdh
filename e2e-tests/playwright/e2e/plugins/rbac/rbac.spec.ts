import { Locator, Page, expect, test } from "@playwright/test";
import { Response, Roles } from "../../../support/pages/rbac";
import { UI_HELPER_ELEMENTS } from "../../../support/page-objects/global-obj";
import {
  SEARCH_OBJECTS_COMPONENTS,
  ROLE_OVERVIEW_COMPONENTS_TEST_ID,
  ROLES_PAGE_COMPONENTS,
} from "../../../support/page-objects/page-obj";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { RbacPo } from "../../../support/page-objects/rbac-po";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import RhdhRbacApi from "../../../support/api/rbac-api";
import { RbacConstants } from "../../../data/rbac-constants";
import { Policy } from "../../../support/api/rbac-api-structures";
import { CatalogImport } from "../../../support/pages/catalog-import";
import { downloadAndReadFile } from "../../../utils/helper";

/*
    Note that:
    The policies generated from a policy.csv or ConfigMap file cannot be edited or deleted using the Developer Hub Web UI.
    https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.3/html/authorization/managing-authorizations-by-using-the-web-ui#proc-rbac-ui-edit-role_title-authorization
*/
test.describe.serial("Test RBAC", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });
  test.describe
    .serial("Test RBAC plugin: load permission policies and conditions from files", () => {
    test.beforeEach(async ({ page }) => {
      await new Common(page).loginAsKeycloakUser();
      const uiHelper = new UIhelper(page);
      await uiHelper.goToPageUrl("/rbac");
    });

    test("Check UI navigation by nav bar when RBAC is enabled", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      await uiHelper.goToPageUrl("/", "Welcome back!");
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
      const uiHelper = new UIhelper(page);

      const testRole: string = "role:default/test2-role";

      await uiHelper.verifyHeading(/All roles \(\d+\)/);
      await uiHelper.verifyLink(testRole);
      await uiHelper.clickLink(testRole);

      await uiHelper.verifyHeading(testRole);
      await uiHelper.clickTab("Overview");

      await uiHelper.verifyText("About");
      await uiHelper.verifyText("csv permission policy file");

      await uiHelper.verifyHeading("1 group");
      await uiHelper.verifyHeading("3 Permissions");
      const permissionPoliciesColumnsText =
        Roles.getPermissionPoliciesListColumnsText();
      await uiHelper.verifyColumnHeading(permissionPoliciesColumnsText);
      const permissionPoliciesCellsIdentifier =
        Roles.getPermissionPoliciesListCellsIdentifier();
      await uiHelper.verifyCellsInTable(permissionPoliciesCellsIdentifier);

      await uiHelper.verifyRowInTableByUniqueText("rhdh-qe-2-team", [
        "Group",
        "1",
      ]);
      await uiHelper.verifyRowInTableByUniqueText("catalog.entity.read", [
        "Read",
        "1 rule",
      ]);
      await uiHelper.verifyRowInTableByUniqueText("catalog.entity.refresh", [
        "Update",
        "1 rule",
      ]);
      await uiHelper.verifyRowInTableByUniqueText("catalog.entity.delete", [
        "Delete",
        "1 rule",
      ]);
    });
  });

  test.describe
    .serial("Test RBAC plugin: $currentUser alias used in conditional access policies", () => {
    test.beforeEach(async ({ page }) => {
      await new Common(page).loginAsKeycloakUser(
        process.env.GH_USER2_ID,
        process.env.GH_USER2_PASS,
      );
    });

    test("Check if aliases used in conditions: the user is allowed to unregister only components they own, not those owned by the group.", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const testUser = "test-rhdh-qe-2";
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder(testUser);
      await page.getByRole("link", { name: testUser, exact: true }).click();

      await expect(page.locator("header")).toContainText(testUser);
      await page.getByTestId("menu-button").click();
      const unregisterUserOwned = page.getByRole("menuitem", {
        name: "Unregister entity",
      });
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
      const unregisterGroupOwned = page.getByRole("menuitem", {
        name: "Unregister entity",
      });
      await expect(unregisterGroupOwned).toBeDisabled();
    });
  });

  test.describe
    .serial("Test RBAC plugin: $ownerRefs alias used in conditional access policies with includeTransitiveGroupOwnership", () => {
    test("Check if user is allowed to read component owned by transitive parent group.", async ({
      page,
    }) => {
      // login as rhdh-qe-3: belongs in rhdh-qe-child-team, which is a sub group of rhdh-qe-parent-team
      await new Common(page).loginAsKeycloakUser(
        process.env.QE_USER3_ID,
        process.env.QE_USER3_PASS,
      );

      const uiHelper = new UIhelper(page);
      // rhdh-qe-parent-team owns mock-site
      const testParentGroup = "rhdh-qe-parent-team";
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder("mock-site");
      await page.getByRole("link", { name: "mock-site" }).click();
      await expect(page.locator("header")).toContainText(testParentGroup);

      // rhdh-qe-child-team owns mock-child-site, check that it can see it's own groups' components
      const testChildGroup = "rhdh-qe-child-team";
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder("mock-child-site");
      await page.getByRole("link", { name: "mock-child-site" }).click();
      await expect(page.locator("header")).toContainText(testChildGroup);
    });

    test("Check if user is allowed to read component owned by transitive parent group with 2 layers of hierarchy.", async ({
      page,
    }) => {
      // login as rhdh-qe-4: belongs in rhdh-qe-sub-child-team, which is a sub group of rhdh-qe-child-team
      await new Common(page).loginAsKeycloakUser(
        process.env.QE_USER4_ID,
        process.env.QE_USER4_PASS,
      );

      const uiHelper = new UIhelper(page);
      // rhdh-qe-parent-team owns mock-site
      const testParentGroup = "rhdh-qe-parent-team";
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder("mock-site");
      await page.getByRole("link", { name: "mock-site" }).click();
      await expect(page.locator("header")).toContainText(testParentGroup);

      // rhdh-qe-child-team owns mock-child-site
      const testChildGroup = "rhdh-qe-child-team";
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder("mock-child-site");
      await page.getByRole("link", { name: "mock-child-site" }).click();
      await expect(page.locator("header")).toContainText(testChildGroup);

      // rhdh-qe-sub-child-team owns mock-sub-child-site, check that it can see it's own groups' components
      const testSubChildGroup = "rhdh-qe-sub-child-team";
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.selectMuiBox("Kind", "Component");

      await uiHelper.searchInputPlaceholder("mock-sub-child-site");
      await page.getByRole("link", { name: "mock-sub-child-site" }).click();
      await expect(page.locator("header")).toContainText(testSubChildGroup);
    });
  });

  test.describe("Test RBAC plugin as an admin user", () => {
    test.beforeEach(async ({ page }, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 30_000); // Additional time due to repeated timeout failure in OSD env.
      const common = new Common(page);
      await common.loginAsKeycloakUser();
      const uiHelper = new UIhelper(page);
      await uiHelper.goToPageUrl("/rbac");
      await common.waitForLoad();
      await new UIhelper(page).verifyHeading("RBAC", 30_000);
    });

    test("Check if Administration side nav is present with RBAC plugin", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      await uiHelper.verifyHeading(/All roles \(\d+\)/);
      const allGridColumnsText = Roles.getRolesListColumnsText();
      await uiHelper.verifyColumnHeading(allGridColumnsText);
      const allCellsIdentifier = Roles.getRolesListCellsIdentifier();
      await uiHelper.verifyCellsInTable(allCellsIdentifier);
    });

    test("Should export CSV of the user list", async ({ page }) => {
      const exportCsvLink = page.getByRole("link", { name: "Export CSV" });
      await exportCsvLink.click();
      const fileContent = await downloadAndReadFile(page, exportCsvLink);
      await test.info().attach("user-list-file", {
        body: fileContent,
        contentType: "text/plain",
      });
      const lines = fileContent.trim().split("\n");

      const header = "userEntityRef,displayName,email,lastAuthTime";
      expect(lines[0], "Header needs to match the expected header").toBe(
        header,
      );

      // Check that each subsequent line starts with "user:default" or "user:development"
      const invalidLines = lines
        .slice(1)
        .filter(
          (line) =>
            !line.startsWith("user:default") &&
            !line.startsWith("user:development"),
        );

      await test.step(`Validate user lines: ${invalidLines.length} invalid out of ${lines.length} total`, async () => {
        expect(invalidLines, "All users should be valid").toHaveLength(0);
      });
    });

    test("View details of a role", async ({ page }) => {
      const uiHelper = new UIhelper(page);
      await uiHelper.clickLink("role:default/rbac_admin");

      await uiHelper.verifyHeading("role:default/rbac_admin");
      await uiHelper.clickTab("Overview");

      await uiHelper.verifyText("About");

      await uiHelper.verifyHeading("1 user");
      const usersAndGroupsColumnsText =
        Roles.getUsersAndGroupsListColumnsText();
      await uiHelper.verifyColumnHeading(usersAndGroupsColumnsText);
      const usersAndGroupsCellsIdentifier =
        Roles.getUsersAndGroupsListCellsIdentifier();
      await uiHelper.verifyCellsInTable(usersAndGroupsCellsIdentifier);

      await uiHelper.verifyHeading("5 permissions");
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
      const uiHelper = new UIhelper(page);

      await uiHelper.clickButton("Create");
      await uiHelper.verifyHeading("Create role");
      await uiHelper.fillTextInputByLabel("name", "sample-role-1");
      await uiHelper.fillTextInputByLabel(
        "description",
        "Test Description data",
      );

      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await uiHelper.fillTextInputByLabel(
        "Select users and groups",
        "sample-role-1",
      );
      await page
        .getByTestId("users-and-groups-text-field")
        .getByLabel("clear search")
        .click();
      await expect(
        page.getByTestId("users-and-groups-text-field").locator("input"),
      ).toBeEmpty();
      await uiHelper.verifyHeading("No users and groups selected");
      await uiHelper.clickButton("Cancel");
      await uiHelper.verifyText("Exit role creation?");
      await uiHelper.clickButton("Discard");
      await expect(page.getByRole("alert")).toHaveCount(0);

      const rbacPo = new RbacPo(page);
      const testUser = "Jonathon Page";
      await rbacPo.createRole(
        "test-role",
        [RbacPo.rbacTestUsers.guest, RbacPo.rbacTestUsers.tara],
        [RbacPo.rbacTestUsers.backstage],
        [{ permission: "catalog.entity.delete" }],
      );
      await page.click(
        ROLES_PAGE_COMPONENTS.editRole("role:default/test-role"),
      );
      await uiHelper.verifyHeading("Edit Role");
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await rbacPo.addUsersAndGroups(testUser);
      await page.click(rbacPo.selectMember(testUser));
      await uiHelper.verifyHeading(rbacPo.regexpShortUsersAndGroups(3, 1));
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role updated successfully",
      );

      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .waitFor({ state: "visible" });
      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");
      const usersAndGroupsLocator = page
        .locator(UI_HELPER_ELEMENTS.MuiTableCell)
        .filter({ hasText: rbacPo.regexpShortUsersAndGroups(3, 1) });
      await usersAndGroupsLocator.waitFor();
      await expect(usersAndGroupsLocator).toBeVisible();

      await rbacPo.deleteRole("role:default/test-role");
    });

    test("Edit users and groups and update policies of a role from the overview page", async ({
      page,
    }) => {
      const uiHelper = new UIhelper(page);
      const rbacPo = new RbacPo(page);
      await rbacPo.createRole(
        "test-role1",
        [RbacPo.rbacTestUsers.guest, RbacPo.rbacTestUsers.tara],
        [RbacPo.rbacTestUsers.backstage],
        [{ permission: "catalog.entity.delete" }],
      );

      await uiHelper.searchInputAriaLabel("test-role1");

      await uiHelper.clickLink("role:default/test-role1");

      await uiHelper.verifyHeading("role:default/test-role1");
      await uiHelper.clickTab("Overview");

      await page
        .getByTestId(ROLE_OVERVIEW_COMPONENTS_TEST_ID.updateMembers)
        .click();
      await uiHelper.verifyHeading("Edit Role");
      await uiHelper.fillTextInputByLabel(
        "Select users and groups",
        "Guest User",
      );
      await page.click(rbacPo.selectMember("Guest User"));
      await uiHelper.verifyHeading(rbacPo.regexpShortUsersAndGroups(1, 1));
      await uiHelper.clickByDataTestId("nextButton-1");
      let nextButton2: Locator;
      let matchNextButton2: Locator[];
      let attempts = 0;
      do {
        await page.waitForTimeout(500);
        nextButton2 = page.locator('[data-testid="nextButton-2"]');
        matchNextButton2 = await nextButton2.all();
        attempts++;
        // eslint-disable-next-line playwright/no-conditional-in-test
      } while (matchNextButton2.length > 1 && attempts < 5);
      // eslint-disable-next-line playwright/no-force-option
      await nextButton2.click({ force: true });
      await page.waitForTimeout(1_000);
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role1 updated successfully",
      );
      await uiHelper.verifyHeading(rbacPo.regexpShortUsersAndGroups(1, 1));

      await page
        .getByTestId(ROLE_OVERVIEW_COMPONENTS_TEST_ID.updatePolicies)
        .click();
      await uiHelper.verifyHeading("Edit Role");
      await rbacPo.selectPluginsCombobox.click();
      await rbacPo.selectOption("scaffolder");
      await page.getByText("Select...").click();
      await rbacPo.selectPermissionCheckbox("scaffolder.template.parameter");
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role1 updated successfully",
      );
      await uiHelper.verifyHeading("2 permissions");

      await rbacPo.deleteRole("role:default/test-role1");
    });

    test("Create a role with a permission policy per resource type and verify that the only authorized users can access specific resources.", async ({
      page,
    }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2127
      test.fixme(true, "Cannot delete role because of missing permissions");

      const uiHelper = new UIhelper(page);
      const rbacPo = new RbacPo(page);
      await rbacPo.createConditionalRole(
        "test-role1",
        ["Guest User", "rhdh-qe rhdh-qe"],
        ["Backstage"],
        "anyOf",
        "catalog",
        "user:default/rhdh-qe",
      );

      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .waitFor({ state: "visible" });
      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .fill("test-role1");
      await uiHelper.verifyHeading("All roles (1)");
      await rbacPo.deleteRole("role:default/test-role1");
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
      const uiHelper = new UIhelper(page);
      await uiHelper.openSidebarButton("Administration");
      const dropdownMenuLocator = page.locator(`text="RBAC"`);
      await expect(dropdownMenuLocator).toBeHidden();
    });
  });

  test.describe.serial("Test RBAC API", () => {
    test.describe.configure({ retries: 0 });
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let apiToken: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UIhelper(page);
      common = new Common(page);

      await common.loginAsKeycloakUser();
      apiToken = await RhdhAuthApiHack.getToken(page);
    });

    test.beforeEach(async ({}, testInfo) => {
      console.log(
        `beforeEach: Attempting setup for ${testInfo.title}, retry: ${testInfo.retry}`,
      );
    });

    // TODO: https://issues.redhat.com/browse/RHDHBUGS-2100
    test.fixme(
      "Test that roles and policies from GET request are what expected",
      async () => {
        const rbacApi = await RhdhRbacApi.build(apiToken);

        const rolesResponse = await rbacApi.getRoles();

        const policiesResponse = await rbacApi.getPolicies();

        // eslint-disable-next-line playwright/no-conditional-in-test
        if (!rolesResponse.ok()) {
          throw Error(
            `RBAC rolesResponse API call failed with status code ${rolesResponse.status()}`,
          );
        }

        // eslint-disable-next-line playwright/no-conditional-in-test
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
      },
    );

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

      const newRole = { memberReferences: members, name: "role:default/test" };

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
      await uiHelper.clickButton("Self-service");
      await page.reload();
      await uiHelper.verifyText(
        "No templates found that match your filter. Learn more about",
        false,
      );
    });

    test("Test catalog-entity refresh is denied", async () => {
      await page.reload();
      await uiHelper.openSidebar("Catalog");
      expect(
        await uiHelper.isBtnVisibleByTitle("Schedule entity refresh"),
      ).toBeFalsy();
    });

    test("Test catalog-entity create is allowed", async () => {
      await page.reload();
      await uiHelper.openSidebar("Catalog");
      await uiHelper.clickButton("Self-service");
      await uiHelper.verifyLinkVisible("Import an existing Git repository");
      await uiHelper.clickButton("Import an existing Git repository");
      const catalogImport = new CatalogImport(page);
      const component =
        "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";
      await catalogImport.registerExistingComponent(component);
    });

    test("Test bad PUT and PUT catalog-entity update policy", async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      const oldPolicy = [
        { permission: "catalog-entity", policy: "read", effect: "deny" },
      ];
      const newBadPolicy = [
        { permission: "catalog-entity", policy: "refresh", effect: "allow" },
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
        oldPolicy,
        newBadPolicy,
      );

      const goodPutResponse = await rbacApi.updatePolicy(
        "default/test",
        oldPolicy,
        newGoodPolicy,
      );

      expect(badPutResponse.ok()).toBeFalsy();
      expect(goodPutResponse.ok()).toBeTruthy();
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

      expect(deleteResponse.ok()).toBeTruthy();
    });

    test.afterAll(async () => {
      const rbacApi = await RhdhRbacApi.build(apiToken);

      try {
        const remainingPoliciesResponse =
          await rbacApi.getPoliciesByRole("default/test");

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
        console.error("Error during cleanup in afterAll:", error);
      }
    });
  });

  test.describe.serial("Test RBAC ownership conditional rule", () => {
    test.beforeEach(async ({}, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 30_000); // Additional time due to repeated timeout failure in OSD env.
    });

    test("Create a role with the `IsOwner` conditional rule.", async ({
      page,
    }) => {
      const common = new Common(page);
      await common.loginAsKeycloakUser();
      const uiHelper = new UIhelper(page);
      await uiHelper.goToPageUrl("/rbac");
      await common.waitForLoad();
      await new UIhelper(page).verifyHeading("RBAC", 30_000);

      const rbacPo = new RbacPo(page);
      await rbacPo.createRBACConditionRole(
        "test-conditional-role",
        [`${process.env.QE_USER6_ID} ${process.env.QE_USER6_ID}`],
        "user:default/rhdh-qe-6",
      );

      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .waitFor({ state: "visible" });
      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .fill("test-conditional-role");
      await uiHelper.verifyHeading("All roles (1)");
    });

    test("Test that user with `IsOwner` condition can access the RBAC page, create a role, edit a role, and delete the role", async ({
      page,
    }) => {
      const common = new Common(page);
      await common.loginAsKeycloakUser(
        process.env.QE_USER6_ID,
        process.env.QE_USER6_PASS,
      );
      const uiHelper = new UIhelper(page);
      await uiHelper.goToPageUrl("/rbac");
      await common.waitForLoad();
      await new UIhelper(page).verifyHeading("RBAC", 30_000);

      const rbacPo = new RbacPo(page);
      const testUser = "Jonathon Page";
      await rbacPo.createRole(
        "test-role",
        [RbacPo.rbacTestUsers.guest, RbacPo.rbacTestUsers.tara],
        [RbacPo.rbacTestUsers.backstage],
        [{ permission: "catalog.entity.delete" }],
        "catalog",
        "user:default/rhdh-qe-6",
      );

      await page.click(
        ROLES_PAGE_COMPONENTS.editRole("role:default/test-role"),
      );
      await uiHelper.verifyHeading("Edit Role");
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await rbacPo.addUsersAndGroups(testUser);
      await page.click(rbacPo.selectMember(testUser));
      await uiHelper.verifyHeading(rbacPo.regexpShortUsersAndGroups(3, 1));
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await uiHelper.clickButton("Next");
      await page.waitForTimeout(1_000);
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role updated successfully",
      );

      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .waitFor({ state: "visible" });
      await page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");
      await rbacPo.deleteRole("role:default/test-role", "All roles");
    });

    test("Ensure that the admin can revoke access", async ({ page }) => {
      const common = new Common(page);
      await common.loginAsKeycloakUser();
      const uiHelper = new UIhelper(page);
      await uiHelper.goToPageUrl("/rbac");
      await common.waitForLoad();
      await new UIhelper(page).verifyHeading("RBAC", 30_000);

      const rbacPo = new RbacPo(page);
      await rbacPo.deleteRole("role:default/test-conditional-role");
    });

    test("Ensure access to user has been revoked", async ({ page }) => {
      const common = new Common(page);
      await common.loginAsKeycloakUser(
        process.env.QE_USER6_ID,
        process.env.QE_USER6_PASS,
      );
      const uiHelper = new UIhelper(page);
      await uiHelper.openSidebarButton("Administration");
      const dropdownMenuLocator = page.locator(`text="RBAC"`);
      await expect(dropdownMenuLocator).toBeHidden();
    });
  });
});
