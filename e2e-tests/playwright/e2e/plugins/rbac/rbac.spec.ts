import { Locator, Page, expect, test } from "@playwright/test";
import { UIhelperPO } from "../../../support/pageObjects/global-obj";
import {
  HomePagePO,
  RoleFormPO,
  RoleListPO,
  RoleOverviewPO,
} from "../../../support/pageObjects/page-obj";
import { Roles } from "../../../support/pages/rbac";
import { Common, setupBrowser } from "../../../utils/Common";
import { UIhelper } from "../../../utils/UIhelper";
import fs from "fs/promises";

// TODO: reenable tests, replace skip with serial
test.describe.skip(
  "Test RBAC plugin: load permission policies and conditions from files",
  () => {
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;

      uiHelper = new UIhelper(page);
      common = new Common(page);
      await common.loginAsGithubUser();
      await uiHelper.openSidebarButton("Administration");
      await uiHelper.openSidebar("RBAC");
      await uiHelper.verifyHeading("RBAC");
    });

    test.beforeEach(
      async () => await new Common(page).checkAndClickOnGHloginPopup(),
    );

    test("Check if permission policies defined in files are loaded and effective", async () => {
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

      await page.getByTestId("update-members").getByLabel("Update").click();
      await expect(page.locator("tbody")).toContainText("rhdh-qe-2-team");
      await uiHelper.clickButton("Next");
      await page.getByLabel("configure-access").first().click();
      await expect(page.getByPlaceholder("string, string")).toHaveValue(
        "group:janus-qe/rhdh-qe-2-team,$currentUser",
      );
      await page.getByTestId("cancel-conditions").click();
      await page.getByLabel("configure-access").nth(1).click();
      await expect(page.getByPlaceholder("string, string")).toHaveValue(
        "$currentUser",
      );
      await page.getByTestId("cancel-conditions").click();
      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Cancel");
    });

    test.afterAll(async () => {
      await page.close();
    });
  },
);

test.describe
  .serial("Test RBAC plugin: Aliases used in conditional access policies", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGithubUser(process.env.GH_USER2_ID);
  });

  test.beforeEach(
    async () => await new Common(page).checkAndClickOnGHloginPopup(),
  );

  test("Check if aliases used in conditions: the user is allowed to unregister only components they own, not those owned by the group.", async () => {
    await uiHelper.openSidebar("Catalog");
    await uiHelper.selectMuiBox("Kind", "Component");

    await uiHelper.searchInputPlaceholder("test-rhdh-qe-2");
    await page
      .getByRole("link", { name: "test-rhdh-qe-2", exact: true })
      .click();

    await expect(page.locator("header")).toContainText("user:rhdh-qe-2");
    await page.getByTestId("menu-button").click();
    const unregisterUserOwned = page.getByText("Unregister entity");
    await expect(unregisterUserOwned).toBeEnabled();

    await page.getByText("Unregister entity").click();
    await expect(page.getByRole("heading")).toContainText(
      "Are you sure you want to unregister this entity?",
    );
    await page.getByRole("button", { name: "Cancel" }).click();

    await uiHelper.openSidebar("Catalog");
    await page.getByRole("link", { name: "test-rhdh-qe-2-team-owned" }).click();
    await expect(page.locator("header")).toContainText(
      "janus-qe/rhdh-qe-2-team",
    );
    await page.getByTestId("menu-button").click();
    const unregisterGroupOwned = page.getByText("Unregister entity");
    await expect(unregisterGroupOwned).toBeDisabled();
  });

  test.afterAll(async () => {
    await page.close();
  });
});

test.describe.serial("Test RBAC plugin as an admin user", () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;
  let rolesHelper: Roles;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    rolesHelper = new Roles(page);
    await common.loginAsGithubUser();
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("RBAC");
    await uiHelper.verifyHeading("RBAC");
  });

  test.beforeEach(
    async () => await new Common(page).checkAndClickOnGHloginPopup(),
  );

  test("Check if Administration side nav is present with RBAC plugin", async () => {
    await uiHelper.verifyHeading(/All roles \(\d+\)/);
    const allGridColumnsText = Roles.getRolesListColumnsText();
    await uiHelper.verifyColumnHeading(allGridColumnsText);
    const allCellsIdentifier = Roles.getRolesListCellsIdentifier();
    await uiHelper.verifyCellsInTable(allCellsIdentifier);
  });

  test("Should download the user list", async () => {
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

  async function downloadAndReadFile(page: Page): Promise<string | undefined> {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('a:has-text("Download User List")').click(),
    ]);

    const filePath = await download.path();

    if (filePath) {
      const fileContent = await fs.readFile(filePath, "utf-8");
      return fileContent;
    } else {
      console.error("Download failed or path is not available");
      return undefined;
    }
  }

  test("View details of a role", async () => {
    await uiHelper.clickLink("role:default/rbac_admin");

    await uiHelper.verifyHeading("role:default/rbac_admin");
    await uiHelper.clickTab("Overview");

    await uiHelper.verifyText("About");

    await uiHelper.verifyHeading("Users and groups (1 user");
    const usersAndGroupsColumnsText = Roles.getUsersAndGroupsListColumnsText();
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

  test("Create and edit a role from the roles list page", async () => {
    await rolesHelper.createRole("test-role");
    await page.click(RoleListPO.editRole("role:default/test-role"));
    await uiHelper.verifyHeading("Edit Role");
    await uiHelper.clickButton("Next");
    await page.fill(RoleFormPO.addUsersAndGroups, "Jonathon Page");
    await page.click(RoleFormPO.selectMember("Jonathon Page"));
    await uiHelper.verifyHeading("Users and groups (3 users, 1 group)");
    await uiHelper.clickButton("Next");
    const addButton = page.getByRole("button", { name: "Add" });
    await addButton.waitFor();
    await uiHelper.clickButton("Next");

    await uiHelper.clickButton("Save");
    await uiHelper.verifyText(
      "Role role:default/test-role updated successfully",
    );

    await page.locator(HomePagePO.searchBar).waitFor({ state: "visible" });
    await page.locator(HomePagePO.searchBar).fill("test-role");
    await uiHelper.verifyHeading("All roles (1)");
    const usersAndGroupsLocator = page
      .locator(UIhelperPO.MuiTableCell)
      .filter({ hasText: "3 users, 1 group" });
    await usersAndGroupsLocator.waitFor();
    await expect(usersAndGroupsLocator).toBeVisible();

    await rolesHelper.deleteRole("role:default/test-role");
  });

  test("Edit users and groups and update policies of a role from the overview page", async () => {
    await rolesHelper.createRole("test-role1");

    await uiHelper.filterInputPlaceholder("test-role1");

    await uiHelper.clickLink("role:default/test-role1");

    await uiHelper.verifyHeading("role:default/test-role1");
    await uiHelper.clickTab("Overview");

    await page.click(RoleOverviewPO.updateMembers);
    await uiHelper.verifyHeading("Edit Role");
    await page.locator(HomePagePO.searchBar).fill("Guest User");
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

    await page.click(RoleOverviewPO.updatePolicies);
    await uiHelper.verifyHeading("Edit Role");
    await page.click(RoleFormPO.addPermissionPolicy);
    await page.click(RoleFormPO.selectPermissionPolicyPlugin(1), {
      timeout: 100000,
    });
    await uiHelper.optionSelector("scaffolder");
    await page.click(RoleFormPO.selectPermissionPolicyPermission(1));
    await uiHelper.optionSelector("scaffolder-template");
    await uiHelper.clickButton("Next");
    await uiHelper.clickButton("Save");
    await uiHelper.verifyText(
      "Role role:default/test-role1 updated successfully",
    );
    await uiHelper.verifyHeading("Permission Policies (3)");

    await rolesHelper.deleteRole("role:default/test-role1");
  });

  test("Create a role with a permission policy per resource type and verify that the only authorized users can access specific resources.", async () => {
    await rolesHelper.createRoleWithPermissionPolicy("test-role");

    await page.locator(HomePagePO.searchBar).waitFor({ state: "visible" });
    await page.locator(HomePagePO.searchBar).fill("test-role");
    await uiHelper.verifyHeading("All roles (1)");
    await rolesHelper.deleteRole("role:default/test-role");
  });

  //FIXME
  test.fixme(
    "Admin cannot create a role if there are no rules defined for the selected resource type.",
    async () => {
      await uiHelper.clickButton("Create");
      await uiHelper.verifyHeading("Create role");

      await page.fill(RoleFormPO.roleName, "test-role");
      await uiHelper.clickButton("Next");
      await page.fill(RoleFormPO.addUsersAndGroups, "guest user");
      await page.click(RoleFormPO.selectMember("Guest User"));
      await uiHelper.clickButton("Next");

      await page.click(RoleFormPO.selectPermissionPolicyPlugin(0), {
        timeout: 100000,
      });
      await uiHelper.optionSelector("catalog");

      await page.click(RoleFormPO.selectPermissionPolicyPermission(0), {
        timeout: 100000,
      });
      await uiHelper.optionSelector("catalog.entity.create");

      await expect(page.getByLabel("configure-access")).not.toBeVisible();
      await uiHelper.clickButton("Cancel");
    },
  );

  test.fixme(
    "As an RHDH admin, I want to be able to restrict access by using the Not condition to part of the plugin, so that some information is protected from unauthorized access.",
    async () => {
      await rolesHelper.createRoleWithNotPermissionPolicy("test-role");
      await page.locator(HomePagePO.searchBar).waitFor({ state: "visible" });
      await page.locator(HomePagePO.searchBar).fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");

      await rolesHelper.deleteRole("role:default/test-role");
    },
  );

  test.fixme(
    "As an RHDH admin, I want to be able to edit the access rule, so I can keep it up to date and be able to add more plugins in the future.",
    async () => {
      await rolesHelper.createRoleWithNotPermissionPolicy("test-role");
      await page.locator(HomePagePO.searchBar).waitFor({ state: "visible" });
      await page.locator(HomePagePO.searchBar).fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");

      await page.click(RoleListPO.editRole("role:default/test-role"));
      await uiHelper.verifyHeading("Edit Role");
      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Next");

      await page.getByLabel("configure-access").click();
      await page.getByRole("button", { name: "Condition" }).click();
      await page.getByTestId("rules-sidebar").getByLabel("Open").click();
      await page.getByText("HAS_SPEC").click();
      await page.getByLabel("key *").click();
      await page.getByLabel("key *").fill("lifecycle");
      await page.getByTestId("save-conditions").click();

      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Save");
      await uiHelper.verifyText(
        "Role role:default/test-role updated successfully",
      );

      await rolesHelper.deleteRole("role:default/test-role");
    },
  );

  test.fixme(
    "As an RHDH admin, I want to be able to remove an access rule from an existing permission policy.",
    async () => {
      await rolesHelper.createRoleWithPermissionPolicy("test-role");
      await page.locator(HomePagePO.searchBar).waitFor({ state: "visible" });
      await page.locator(HomePagePO.searchBar).fill("test-role");
      await uiHelper.verifyHeading("All roles (1)");

      await page.click(RoleListPO.editRole("role:default/test-role"));
      await uiHelper.verifyHeading("Edit Role");
      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Next");

      await page.getByLabel("configure-access").click();
      await page.getByRole("button", { name: "Remove" }).nth(2).click();
      await page.getByTestId("save-conditions").click();
      await uiHelper.verifyText("Configure access (2 rules)");

      await uiHelper.clickButton("Next");
      await uiHelper.clickButton("Save");

      await uiHelper.verifyText(
        "Role role:default/test-role updated successfully",
      );

      await rolesHelper.deleteRole("role:default/test-role");
    },
  );

  test.afterAll(async () => {
    await page.close();
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
    await expect(dropdownMenuLocator).not.toBeVisible();
  });
});
