import { Page, expect, test } from '@playwright/test';
import { Roles } from '../../../support/pages/rbac';
import { Common, setupBrowser } from '../../../utils/Common';
import { UIhelper } from '../../../utils/UIhelper';

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
    const unregisterUserOwned = page.getByText('Unregister entity');
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
    const unregisterGroupOwned = page.getByText('Unregister entity');
    await expect(unregisterGroupOwned).toBeDisabled();
  });

  test.afterAll(async () => {
    await page.close();
  });
});
