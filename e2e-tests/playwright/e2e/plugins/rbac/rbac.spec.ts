import { Page, expect, test } from '@playwright/test';
import { UIhelperPO } from '../../../support/pageObjects/global-obj';
import {
  HomePagePO,
  RoleFormPO,
  RoleListPO,
  RoleOverviewPO,
} from '../../../support/pageObjects/page-obj';
import { Roles, Response } from '../../../support/pages/rbac';
import { Common, setupBrowser } from '../../../utils/Common';
import { UIhelper } from '../../../utils/UIhelper';

test.describe.serial('Test RBAC plugin REST API', () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;
  let responseHelper: Response;

  test.beforeAll(async ({ browser, baseURL }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);

    await common.loginAsGithubUser();

    await uiHelper.openSidebar('Catalog');
    const requestPromise = page.waitForRequest(
      request =>
        request.url() === `${baseURL}/api/search/query?term=` &&
        request.method() === 'GET',
    );
    await uiHelper.openSidebar('Home');
    const getRequest = await requestPromise;
    const authToken = await getRequest.headerValue('Authorization');

    responseHelper = new Response(authToken);
  });

  test('Test that roles and policies from GET request are what expected', async ({
    request,
  }) => {
    const rolesResponse = await request.get(
      '/api/permission/roles',
      responseHelper.getSimpleRequest(),
    );
    const policiesResponse = await request.get(
      '/api/permission/policies',
      responseHelper.getSimpleRequest(),
    );

    await responseHelper.checkResponse(
      await rolesResponse,
      responseHelper.getExpectedRoles(),
    );
    await responseHelper.checkResponse(
      await policiesResponse,
      responseHelper.getExpectedPolicies(),
    );
  });

  test('Create new role for rhdh-qe, change its name, and deny it from reading catalog entities', async ({
    request,
  }) => {
    const members = ['user:default/rhdh-qe'];

    const firstRole = {
      memberReferences: members,
      name: 'role:default/admin',
    };
    const rolePostResponse = await request.post(
      '/api/permission/roles',
      responseHelper.createRoleRequest(firstRole),
    );
    const newRole = {
      memberReferences: members,
      name: 'role:default/test',
    };

    const rolePutResponse = await request.put(
      '/api/permission/roles/role/default/admin',
      responseHelper.editRoleRequest(firstRole, newRole),
    );

    const newPolicy = {
      entityReference: 'role:default/test',
      permission: 'catalog-entity',
      policy: 'read',
      effect: 'deny',
    };

    const policyPostResponse = await request.post(
      '/api/permission/policies',
      responseHelper.createOrDeletePolicyRequest([newPolicy]),
    );

    expect(rolePostResponse.ok()).toBeTruthy();
    expect(rolePutResponse.ok()).toBeTruthy();
    expect(policyPostResponse.ok()).toBeTruthy();
  });

  test('Test catalog-entity read is denied', async () => {
    await uiHelper.openSidebar('Catalog');
    await uiHelper.selectMuiBox('Kind', 'Component');
    await uiHelper.verifyTableIsEmpty();
    await uiHelper.openSidebar('Create...');
    await uiHelper.verifyText(
      'No templates found that match your filter. Learn more about',
      false,
    );
  });

  test('Test catalog-entity creation is denied', async () => {
    expect(
      await uiHelper.isLinkVisible('Register Existing Component'),
    ).toBeFalsy();
  });

  test('PUT catalog-entity read and POST create policies', async ({
    request,
  }) => {
    const oldReadPolicy = [
      { permission: 'catalog-entity', policy: 'read', effect: 'deny' },
    ];
    const newReadPolicy = [
      { permission: 'catalog-entity', policy: 'read', effect: 'allow' },
    ];
    const readPutResponse = await request.put(
      '/api/permission/policies/role/default/test',
      responseHelper.editPolicyRequest(oldReadPolicy, newReadPolicy),
    );

    const createPolicy = [
      {
        entityReference: 'role:default/test',
        permission: 'catalog.entity.create',
        policy: 'create',
        effect: 'allow',
      },
    ];
    const createPostResponse = await request.post(
      '/api/permission/policies',
      responseHelper.createOrDeletePolicyRequest(createPolicy),
    );

    expect(readPutResponse.ok()).toBeTruthy();
    expect(createPostResponse.ok()).toBeTruthy();
  });

  test('Test catalog-entity read is allowed', async () => {
    await uiHelper.openSidebar('Catalog');
    await uiHelper.selectMuiBox('Kind', 'API');
    await uiHelper.clickLink('Nexus Repo Manager 3');
  });

  test('Test catalog-entity refresh is denied', async () => {
    expect(
      await uiHelper.isBtnVisibleByTitle('Schedule entity refresh'),
    ).toBeFalsy();
  });

  test('Test catalog-entity create is allowed', async () => {
    await uiHelper.openSidebar('Create...');
    expect(
      await uiHelper.isLinkVisible('Register Existing Component'),
    ).toBeTruthy();
  });

  test('Test bad PUT and PUT catalog-entity update policy', async ({
    request,
  }) => {
    const oldBadPolicy = [
      { permission: 'catalog-entity', policy: 'refresh', effect: 'allow' },
    ];
    const newBadPolicy = [
      { permission: 'catalog-entity', policy: 'read', effect: 'allow' },
    ];
    const badPutResponse = await request.put(
      '/api/permission/policies/role/default/test',
      responseHelper.editPolicyRequest(oldBadPolicy, newBadPolicy),
    );

    const oldGoodPolicy = [
      {
        permission: 'catalog.entity.create',
        policy: 'create',
        effect: 'allow',
      },
    ];
    const newGoodPolicy = [
      {
        permission: 'catalog.entity.refresh',
        policy: 'update',
        effect: 'allow',
      },
    ];
    const goodPutResponse = await request.put(
      '/api/permission/policies/role/default/test',
      responseHelper.editPolicyRequest(oldGoodPolicy, newGoodPolicy),
    );

    expect(badPutResponse.ok()).toBeFalsy();
    expect(goodPutResponse.ok()).toBeTruthy();
  });

  test('Test that the bad PUT didnt go through and catalog-entities can be read', async () => {
    await uiHelper.openSidebar('Home');
    await uiHelper.openSidebar('Create...');
    expect(
      await uiHelper.isTextVisible(
        'No templates found that match your filter. Learn more about',
      ),
    ).toBeFalsy();
  });

  test('Test that the good PUT request went through and catalog-entities can be refreshed', async () => {
    await uiHelper.openSidebar('Catalog');
    await uiHelper.selectMuiBox('Kind', 'API');
    await uiHelper.clickLink('Nexus Repo Manager 3');
    expect(
      await uiHelper.isBtnVisibleByTitle('Schedule entity refresh'),
    ).toBeTruthy();
  });

  test('Test that the good PUT request went through and catalog-entities cant be created', async () => {
    await uiHelper.openSidebar('Create...');
    expect(
      await uiHelper.isLinkVisible('Register Existing Component'),
    ).toBeFalsy();
  });

  test('DELETE catalog-entity update policy', async ({ request }) => {
    const deletePolicies = [
      {
        entityReference: 'role:default/test',
        permission: 'catalog.entity.refresh',
        policy: 'update',
        effect: 'allow',
      },
    ];
    const deleteResponse = await request.delete(
      '/api/permission/policies/role/default/test',
      responseHelper.createOrDeletePolicyRequest(deletePolicies),
    );

    expect(deleteResponse.ok()).toBeTruthy();
  });

  test('Test catalog-entity refresh is denied after DELETE', async () => {
    await uiHelper.openSidebar('Catalog');
    await uiHelper.selectMuiBox('Kind', 'API');
    await uiHelper.clickLink('Nexus Repo Manager 3');
    expect(await uiHelper.isBtnVisible('Schedule entity refresh')).toBeFalsy();
  });

  test.afterAll(
    'Cleanup by deleting all new policies and roles',
    async ({ request }) => {
      const remainingPoliciesResponse = await request.get(
        '/api/permission/policies/role/default/test',
        responseHelper.getSimpleRequest(),
      );

      const remainingPolicies = await responseHelper.removeMetadataFromResponse(
        remainingPoliciesResponse,
      );

      const deleteRemainingPolicies = await request.delete(
        '/api/permission/policies/role/default/test',
        responseHelper.createOrDeletePolicyRequest(remainingPolicies),
      );

      const deleteRole = await request.delete(
        '/api/permission/roles/role/default/test',
        responseHelper.getSimpleRequest(),
      );

      expect(deleteRemainingPolicies.ok()).toBeTruthy();
      expect(deleteRole.ok()).toBeTruthy();
    },
  );
});

test.describe
  .serial('Test RBAC plugin: load permission policies and conditions from files', () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGithubUser();
    await uiHelper.openSidebarButton('Administration');
    await uiHelper.openSidebar('RBAC');
    await uiHelper.verifyHeading('RBAC');
  });

  test('Check if permission policies defined in files are loaded and effective', async () => {
    const testRole: string = 'role:default/test2-role';

    await uiHelper.verifyHeading(/All roles \(\d+\)/);
    await uiHelper.verifyLink(testRole);
    await uiHelper.clickLink(testRole);

    await uiHelper.verifyHeading(testRole);
    await uiHelper.clickTab('Overview');

    await uiHelper.verifyText('About');
    await uiHelper.verifyText('csv permission policy file');

    await uiHelper.verifyHeading('Users and groups (1 group');
    await uiHelper.verifyHeading('Permission policies (2)');
    const permissionPoliciesColumnsText =
      Roles.getPermissionPoliciesListColumnsText();
    await uiHelper.verifyColumnHeading(permissionPoliciesColumnsText);
    const permissionPoliciesCellsIdentifier =
      Roles.getPermissionPoliciesListCellsIdentifier();
    await uiHelper.verifyCellsInTable(permissionPoliciesCellsIdentifier);

    await expect(page.getByRole('article')).toContainText('catalog-entity');
    await expect(page.getByRole('article')).toContainText('Read, Update');
    await expect(page.getByRole('article')).toContainText('Delete');

    await page.getByTestId('update-members').getByLabel('Update').click();
    await expect(page.locator('tbody')).toContainText('rhdh-qe-2-team');
    await uiHelper.clickButton('Next');
    await page.getByLabel('configure-access').first().click();
    await expect(page.getByPlaceholder('string, string')).toHaveValue(
      'group:janus-qe/rhdh-qe-2-team,$currentUser',
    );
    await page.getByTestId('cancel-conditions').click();
    await page.getByLabel('configure-access').nth(1).click();
    await expect(page.getByPlaceholder('string, string')).toHaveValue(
      '$currentUser',
    );
    await page.getByTestId('cancel-conditions').click();
    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Cancel');
  });

  test.afterAll(async () => {
    await page.close();
  });
});

test.describe
  .serial('Test RBAC plugin: Aliases used in conditional access policies', () => {
  let common: Common;
  let uiHelper: UIhelper;
  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    page = (await setupBrowser(browser, testInfo)).page;

    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGithubUser(process.env.GH_USER2_ID);
  });

  test('Check if aliases used in conditions: the user is allowed to unregister only components they own, not those owned by the group.', async () => {
    await uiHelper.openSidebar('Catalog');
    await uiHelper.selectMuiBox('Kind', 'Component');

    await uiHelper.searchInputPlaceholder('test-rhdh-qe-2');
    await page
      .getByRole('link', { name: 'test-rhdh-qe-2', exact: true })
      .click();

    await expect(page.locator('header')).toContainText('user:rhdh-qe-2');
    await page.getByTestId('menu-button').click();
    const unregisterUserOwned = await page.getByText('Unregister entity');
    await expect(unregisterUserOwned).toBeEnabled();

    await page.getByText('Unregister entity').click();
    await expect(page.getByRole('heading')).toContainText(
      'Are you sure you want to unregister this entity?',
    );
    await page.getByRole('button', { name: 'Cancel' }).click();

    await uiHelper.openSidebar('Catalog');
    await page.getByRole('link', { name: 'test-rhdh-qe-2-team-owned' }).click();
    await expect(page.locator('header')).toContainText(
      'janus-qe/rhdh-qe-2-team',
    );
    await page.getByTestId('menu-button').click();
    const unregisterGroupOwned = await page.getByText('Unregister entity');
    await expect(unregisterGroupOwned).toBeDisabled();
  });

  test.afterAll(async () => {
    await page.close();
  });
});

test.describe.serial('Test RBAC plugin as an admin user', () => {
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
    await uiHelper.openSidebarButton('Administration');
    await uiHelper.openSidebar('RBAC');
    await uiHelper.verifyHeading('RBAC');
  });

  test('Check if Administration side nav is present with RBAC plugin', async () => {
    await uiHelper.verifyHeading(/All roles \(\d+\)/);
    const allGridColumnsText = Roles.getRolesListColumnsText();
    await uiHelper.verifyColumnHeading(allGridColumnsText);
    const allCellsIdentifier = Roles.getRolesListCellsIdentifier();
    await uiHelper.verifyCellsInTable(allCellsIdentifier);
  });

  test('View details of a role', async () => {
    await uiHelper.clickLink('role:default/rbac_admin');

    await uiHelper.verifyHeading('role:default/rbac_admin');
    await uiHelper.clickTab('Overview');

    await uiHelper.verifyText('About');

    await uiHelper.verifyHeading('Users and groups (1 user');
    const usersAndGroupsColumnsText = Roles.getUsersAndGroupsListColumnsText();
    await uiHelper.verifyColumnHeading(usersAndGroupsColumnsText);
    const usersAndGroupsCellsIdentifier =
      Roles.getUsersAndGroupsListCellsIdentifier();
    await uiHelper.verifyCellsInTable(usersAndGroupsCellsIdentifier);

    await uiHelper.verifyHeading('Permission policies (5)');
    const permissionPoliciesColumnsText =
      Roles.getPermissionPoliciesListColumnsText();
    await uiHelper.verifyColumnHeading(permissionPoliciesColumnsText);
    const permissionPoliciesCellsIdentifier =
      Roles.getPermissionPoliciesListCellsIdentifier();
    await uiHelper.verifyCellsInTable(permissionPoliciesCellsIdentifier);

    await uiHelper.clickLink('RBAC');
  });

  test('Create and edit a role from the roles list page', async () => {
    await rolesHelper.createRole('test-role');
    await page.click(RoleListPO.editRole('role:default/test-role'));
    await uiHelper.verifyHeading('Edit Role');
    await uiHelper.clickButton('Next');
    await page.fill(RoleFormPO.addUsersAndGroups, 'Jonathon Page');
    await page.click(RoleFormPO.selectMember('Jonathon Page'));
    await uiHelper.verifyHeading('Users and groups (3 users, 1 group)');
    await uiHelper.clickButton('Next');
    await page.waitForTimeout(1_000);
    await uiHelper.clickButton('Next');
    await page.waitForTimeout(1_000);
    await uiHelper.clickButton('Save');
    await uiHelper.verifyText(
      'Role role:default/test-role updated successfully',
    );

    await page.locator(HomePagePO.searchBar).waitFor({ state: 'visible' });
    await page.locator(HomePagePO.searchBar).fill('test-role');
    await uiHelper.verifyHeading('All roles (1)');
    const usersAndGroupsLocator = page
      .locator(UIhelperPO.MuiTableCell)
      .filter({ hasText: '3 users, 1 group' });
    await usersAndGroupsLocator.waitFor();
    await expect(usersAndGroupsLocator).toBeVisible();

    await rolesHelper.deleteRole('role:default/test-role');
  });

  test('Edit users and groups and update policies of a role from the overview page', async () => {
    await rolesHelper.createRole('test-role1');
    await uiHelper.clickLink('role:default/test-role1');

    await uiHelper.verifyHeading('role:default/test-role1');
    await uiHelper.clickTab('Overview');

    await page.click(RoleOverviewPO.updateMembers);
    await uiHelper.verifyHeading('Edit Role');
    await page.locator(HomePagePO.searchBar).fill('Guest User');
    await page.click('button[aria-label="Remove"]');
    await uiHelper.verifyHeading('Users and groups (1 user, 1 group)');
    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Save');
    await uiHelper.verifyText(
      'Role role:default/test-role1 updated successfully',
    );
    await uiHelper.verifyHeading('Users and groups (1 user, 1 group)');

    await page.click(RoleOverviewPO.updatePolicies);
    await uiHelper.verifyHeading('Edit Role');
    await page.click(RoleFormPO.addPermissionPolicy);
    await page.click(RoleFormPO.selectPermissionPolicyPlugin(1), {
      timeout: 100000,
    });
    await uiHelper.optionSelector('scaffolder');
    await page.click(RoleFormPO.selectPermissionPolicyPermission(1));
    await uiHelper.optionSelector('scaffolder-template');
    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Save');
    await uiHelper.verifyText(
      'Role role:default/test-role1 updated successfully',
    );
    await uiHelper.verifyHeading('Permission Policies (3)');

    await rolesHelper.deleteRole('role:default/test-role1');
  });

  test('Create a role with a permission policy per resource type and verify that the only authorized users can access specific resources.', async () => {
    await rolesHelper.createRoleWithPermissionPolicy('test-role');

    await page.locator(HomePagePO.searchBar).waitFor({ state: 'visible' });
    await page.locator(HomePagePO.searchBar).fill('test-role');
    await uiHelper.verifyHeading('All roles (1)');
    await rolesHelper.deleteRole('role:default/test-role');
  });

  //FIXME
  test.skip('Admin cannot create a role if there are no rules defined for the selected resource type.', async () => {
    await uiHelper.clickButton('Create');
    await uiHelper.verifyHeading('Create role');

    await page.fill(RoleFormPO.roleName, 'test-role');
    await uiHelper.clickButton('Next');
    await page.fill(RoleFormPO.addUsersAndGroups, 'guest user');
    await page.click(RoleFormPO.selectMember('Guest User'));
    await uiHelper.clickButton('Next');

    await page.click(RoleFormPO.selectPermissionPolicyPlugin(0), {
      timeout: 100000,
    });
    await uiHelper.optionSelector('catalog');

    await page.click(RoleFormPO.selectPermissionPolicyPermission(0), {
      timeout: 100000,
    });
    await uiHelper.optionSelector('catalog.entity.create');

    await expect(page.getByLabel('configure-access')).not.toBeVisible();
    await uiHelper.clickButton('Cancel');
  });

  test.skip('As an RHDH admin, I want to be able to restrict access by using the Not condition to part of the plugin, so that some information is protected from unauthorized access.', async () => {
    await rolesHelper.createRoleWithNotPermissionPolicy('test-role');
    await page.locator(HomePagePO.searchBar).waitFor({ state: 'visible' });
    await page.locator(HomePagePO.searchBar).fill('test-role');
    await uiHelper.verifyHeading('All roles (1)');

    await rolesHelper.deleteRole('role:default/test-role');
  });

  test.skip('As an RHDH admin, I want to be able to edit the access rule, so I can keep it up to date and be able to add more plugins in the future.', async () => {
    await rolesHelper.createRoleWithNotPermissionPolicy('test-role');
    await page.locator(HomePagePO.searchBar).waitFor({ state: 'visible' });
    await page.locator(HomePagePO.searchBar).fill('test-role');
    await uiHelper.verifyHeading('All roles (1)');

    await page.click(RoleListPO.editRole('role:default/test-role'));
    await uiHelper.verifyHeading('Edit Role');
    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Next');

    await page.getByLabel('configure-access').click();
    await page.getByRole('button', { name: 'Condition' }).click();
    await page.getByTestId('rules-sidebar').getByLabel('Open').click();
    await page.getByText('HAS_SPEC').click();
    await page.getByLabel('key *').click();
    await page.getByLabel('key *').fill('lifecycle');
    await page.getByTestId('save-conditions').click();

    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Save');
    await uiHelper.verifyText(
      'Role role:default/test-role updated successfully',
    );

    await rolesHelper.deleteRole('role:default/test-role');
  });

  test.skip('As an RHDH admin, I want to be able to remove an access rule from an existing permission policy.', async () => {
    await rolesHelper.createRoleWithPermissionPolicy('test-role');
    await page.locator(HomePagePO.searchBar).waitFor({ state: 'visible' });
    await page.locator(HomePagePO.searchBar).fill('test-role');
    await uiHelper.verifyHeading('All roles (1)');

    await page.click(RoleListPO.editRole('role:default/test-role'));
    await uiHelper.verifyHeading('Edit Role');
    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Next');

    await page.getByLabel('configure-access').click();
    await page.getByRole('button', { name: 'Remove' }).nth(2).click();
    await page.getByTestId('save-conditions').click();
    await uiHelper.verifyText('Configure access (2 rules)');

    await uiHelper.clickButton('Next');
    await uiHelper.clickButton('Save');

    await uiHelper.verifyText(
      'Role role:default/test-role updated successfully',
    );

    await rolesHelper.deleteRole('role:default/test-role');
  });

  test.afterAll(async () => {
    await page.close();
  });
});

test.describe('Test RBAC plugin as a guest user', () => {
  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test('Check if Administration side nav is present with no RBAC plugin', async ({
    page,
  }) => {
    const uiHelper = new UIhelper(page);
    await uiHelper.openSidebarButton('Administration');
    const dropdownMenuLocator = page.locator(`text="RBAC"`);
    await expect(dropdownMenuLocator).not.toBeVisible();
  });
});
