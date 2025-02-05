import { test, Page, expect } from "@playwright/test";
import { Common, setupBrowser } from "../../utils/common";
import { UiHelper } from "../../utils/ui-helper";
import UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation";
import * as constants from "../../utils/authenticationProviders/constants";
import { LOGGER } from "../../utils/logger";
import GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation";
import {
  waitForNextSync,
  replaceInRBACPolicyFileConfigMap,
  dumpAllPodsLogs,
  dumpRHDHUsersAndGroups,
} from "../../utils/helper";
import { HelmActions } from "../../utils/helm";
import { GroupEntity } from "@backstage/catalog-model";
import { APIHelper } from "../../utils/api-helper";
import { RHSSOHelper } from "../../utils/authenticationProviders/rh-sso-helper";
import { RhdhAuthUiHack } from "../../support/api/rhdh-auth-hack";

let page: Page;

for (const version of ["RHBK", "RHSSO"]) {
  test.describe(`Standard authentication providers: OIDC with ${version}`, () => {
    test.use({ baseURL: constants.AUTH_PROVIDERS_BASE_URL });

    let common: Common;
    let uiHelper: UiHelper;
    let usersCreated: Map<string, UserRepresentation>;
    let groupsCreated: Map<string, GroupRepresentation>;
    const syntTime = 60;
    let mustSync = false;
    let rhssoHelper: RHSSOHelper;

    let helmParams = [];

    test.beforeAll(async ({ browser }, testInfo) => {
      test.setTimeout(120 * 1000);
      LOGGER.info(
        `Staring scenario: Standard authentication providers: OIDC with ${version}: attemp #${testInfo.retry}`,
      );
      expect(constants.RHSSO76_ADMIN_USERNAME).not.toBeNull();
      expect(constants.RHSSO76_ADMIN_PASSWORD).not.toBeNull();
      expect(constants.RHSSO76_DEFAULT_PASSWORD).not.toBeNull();
      expect(constants.RHSSO76_URL).not.toBeNull();
      expect(constants.RHSSO76_CLIENT_SECRET).not.toBeNull();
      expect(constants.RHSSO76_CLIENTID).not.toBeNull();

      expect(constants.RHBK_ADMIN_USERNAME).not.toBeNull();
      expect(constants.RHBK_ADMIN_PASSWORD).not.toBeNull();
      expect(constants.RHBK_DEFAULT_PASSWORD).not.toBeNull();
      expect(constants.RHBK_URL).not.toBeNull();
      expect(constants.RHBK_CLIENT_SECRET).not.toBeNull();
      expect(constants.RHBK_CLIENTID).not.toBeNull();

      expect(constants.RHSSO76_GROUPS).not.toBeNull();
      expect(constants.RHSSO76_NESTED_GROUP).not.toBeNull();
      expect(constants.RHSSO76_USERS).not.toBeNull();
      expect(constants.AUTH_PROVIDERS_REALM_NAME).not.toBeNull();

      expect(constants.AUTH_PROVIDERS_BASE_URL).not.toBeNull();
      expect(constants.AUTH_PROVIDERS_NAMESPACE).not.toBeNull();
      expect(constants.AUTH_PROVIDERS_RELEASE).not.toBeNull();
      expect(constants.AUTH_PROVIDERS_CHART).not.toBeNull();
      expect(constants.CHART_VERSION).not.toBeNull();
      expect(constants.QUAY_REPO).not.toBeNull();
      expect(constants.TAG_NAME).not.toBeNull();
      expect(constants.AUTH_PROVIDERS_VALUES_FILE).not.toBeNull();
      expect(constants.AUTH_PROVIDERS_CHART).not.toBeNull();
      expect(constants.RBAC_POLICY_ROLES).not.toBeNull();
      expect(constants.STATIC_API_TOKEN).not.toBeNull();

      LOGGER.info(`Base Url is ${process.env.BASE_URL}`);

      page = (await setupBrowser(browser, testInfo)).page;
      common = new Common(page);
      uiHelper = new UiHelper(page);

      if (version == "RHSSO") {
        helmParams = [];
      } else if (version == "RHBK") {
        helmParams = [
          "--values ../.ibm/pipelines/value_files/values_showcase-auth-provider-diff-rhbk.yaml",
        ];
      }

      rhssoHelper = new RHSSOHelper(version);
      await rhssoHelper.initializeRHSSOClient();
      const created = await rhssoHelper.setupRHSSOEnvironment();
      usersCreated = created.usersCreated;
      groupsCreated = created.groupsCreated;
    });

    test(`${version} - default resolver should be emailLocalPartMatchingUserEntityName: user_1 should authenticate, user_2 should not`, async () => {
      test.setTimeout(600 * 1000);

      LOGGER.info(`Executing testcase: ${test.info().title}`);
      // setup RHSSO provider with user ingestion
      await HelmActions.upgradeHelmChartWithWait(
        constants.AUTH_PROVIDERS_RELEASE,
        constants.AUTH_PROVIDERS_CHART,
        constants.AUTH_PROVIDERS_NAMESPACE,
        constants.AUTH_PROVIDERS_VALUES_FILE,
        constants.CHART_VERSION,
        constants.QUAY_REPO,
        constants.TAG_NAME,
        [
          "--set global.dynamic.plugins[0].disabled=false",
          "--set upstream.postgresql.primary.persistence.enabled=false",
          "--set upstream.backstage.appConfig.catalog.providers.githubOrg=null",
          "--set upstream.backstage.appConfig.catalog.providers.microsoftOrg=null",
          "--set global.dynamic.plugins[3].disabled=false",
          "--set upstream.backstage.appConfig.permission.enabled=true",
          ...helmParams,
        ],
      );

      await waitForNextSync("rhsso", syntTime);

      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_1"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.openSidebar("Settings");
      await uiHelper.verifyHeading(
        await rhssoHelper.getRHSSOUserDisplayName(
          constants.RHSSO76_USERS["user_1"],
        ),
      );
      await common.signOut();

      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_2"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.verifyAlertErrorMessage(
        "Login failed; caused by NotFoundError: User not found",
      );

      await rhssoHelper.clearUserSessions(
        constants.RHSSO76_USERS["user_2"].username,
        constants.AUTH_PROVIDERS_REALM_NAME,
      );
    });

    test(`${version} - testing resolver emailMatchingUserEntityProfileEmail: user_1 should authenticate, jdoe should not`, async () => {
      test.setTimeout(600 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      // updating the resolver
      // disable keycloak plugin to disable ingestion
      // edit jdoe user in keycloak to have a different email than the synced one: it will not be synced

      await HelmActions.upgradeHelmChartWithWait(
        constants.AUTH_PROVIDERS_RELEASE,
        constants.AUTH_PROVIDERS_CHART,
        constants.AUTH_PROVIDERS_NAMESPACE,
        constants.AUTH_PROVIDERS_VALUES_FILE,
        constants.CHART_VERSION,
        constants.QUAY_REPO,
        constants.TAG_NAME,
        [
          "--set global.dynamic.plugins[0].disabled=false",
          "--set global.dynamic.plugins[1].disabled=true",
          "--set global.dynamic.plugins[2].disabled=true",
          "--set upstream.postgresql.primary.persistence.enabled=false",
          "--set upstream.backstage.appConfig.auth.providers.oidc.production.signIn.resolvers[0].resolver=emailMatchingUserEntityProfileEmail",
          "--set global.dynamic.plugins[3].disabled=false",
          "--set upstream.backstage.appConfig.permission.enabled=true",
          ...helmParams,
        ],
      );

      await waitForNextSync("rhsso", syntTime);

      // emailMatchingUserEntityProfileEmail should only allow authentication of keycloak users that match the email attribute with the entity one.
      // update jdoe email -> login should fail with error Login failed; caused by Error: Failed to sign-in, unable to resolve user identity
      await rhssoHelper.updateUserEmail(
        constants.RHSSO76_USERS["jenny_doe"].username,
        constants.JDOE_NEW_EMAIL,
      );

      // login with testuser1 -> login should succeed
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_1"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.openSidebar("Settings");
      await uiHelper.verifyHeading(
        await rhssoHelper.getRHSSOUserDisplayName(
          constants.RHSSO76_USERS["user_1"],
        ),
      );
      await common.signOut();

      // login with jenny doe -> should fail
      await common.keycloakLogin(
        constants.RHSSO76_USERS["jenny_doe"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.verifyAlertErrorMessage(
        /Login failed; caused by Error: Failed to sign-in, unable to resolve user identity/gm,
      );
      await rhssoHelper.clearUserSessions(
        constants.RHSSO76_USERS["jenny_doe"].username,
        constants.AUTH_PROVIDERS_REALM_NAME,
      );
    });

    test(`${version} - testing resolver preferredUsernameMatchingUserEntityName: user_1 and jenny_doe should both authenticate`, async () => {
      test.setTimeout(600 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);
      // updating the resolver
      // disable keycloak plugin to disable ingestion

      await HelmActions.upgradeHelmChartWithWait(
        constants.AUTH_PROVIDERS_RELEASE,
        constants.AUTH_PROVIDERS_CHART,
        constants.AUTH_PROVIDERS_NAMESPACE,
        constants.AUTH_PROVIDERS_VALUES_FILE,
        constants.CHART_VERSION,
        constants.QUAY_REPO,
        constants.TAG_NAME,
        [
          "--set global.dynamic.plugins[0].disabled=false",
          "--set global.dynamic.plugins[1].disabled=true",
          "--set global.dynamic.plugins[2].disabled=true",
          "--set upstream.postgresql.primary.persistence.enabled=false",
          "--set upstream.backstage.appConfig.auth.providers.oidc.production.signIn.resolvers[0].resolver=preferredUsernameMatchingUserEntityName",
          "--set global.dynamic.plugins[3].disabled=false",
          "--set upstream.backstage.appConfig.permission.enabled=true",
          ...helmParams,
        ],
      );

      // preferredUsernameMatchingUserEntityName should allow authentication of any keycloak.

      await waitForNextSync("rhsso", syntTime);

      // login with testuser1 -> login should succeed
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_1"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.openSidebar("Settings");
      await uiHelper.verifyHeading(
        rhssoHelper.getRHSSOUserDisplayName(constants.RHSSO76_USERS["user_1"]),
      );
      await common.signOut();

      // login with jenny doe -> should succeed
      await common.keycloakLogin(
        constants.RHSSO76_USERS["jenny_doe"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.openSidebar("Settings");
      await uiHelper.verifyHeading(
        rhssoHelper.getRHSSOUserDisplayName(
          constants.RHSSO76_USERS["jenny_doe"],
        ),
      );
      await common.signOut();

      // login with user_2 -> should succeed
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_2"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      await uiHelper.openSidebar("Settings");
      await uiHelper.verifyHeading(
        rhssoHelper.getRHSSOUserDisplayName(constants.RHSSO76_USERS["user_2"]),
      );
      await common.signOut();
    });

    test(`${version} - ingestion of Users and Nested Groups: verify the UserEntities and Groups are created with the correct relationships in RHDH`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      // check users are in the catalog
      const usersDisplayNames = Object.values(constants.RHSSO76_USERS).map(
        (u) => rhssoHelper.getRHSSOUserDisplayName(u),
      );

      expect(
        await common.CheckUserIsIngestedInCatalog(
          usersDisplayNames,
          constants.STATIC_API_TOKEN,
        ),
      ).toBe(true);

      // check groups are in the catalog
      const groupsDisplayNames = Object.values(constants.RHSSO76_GROUPS).map(
        (g) => g.name,
      );
      groupsDisplayNames.push(constants.RHSSO76_NESTED_GROUP.name);
      expect(
        await common.CheckGroupIsIngestedInCatalog(
          groupsDisplayNames,
          constants.STATIC_API_TOKEN,
        ),
      ).toBe(true);

      const api = new APIHelper();
      api.UseStaticToken(constants.STATIC_API_TOKEN);

      // group_1 should show user_1
      const group1: GroupEntity = await api.getGroupEntityFromAPI(
        constants.RHSSO76_GROUPS["group_1"].name,
      );
      expect(
        group1.spec.members.includes(
          constants.RHSSO76_USERS["user_1"].username,
        ),
      ).toBe(true);

      // group_2 should show user_2 and parent group_nested
      const group2: GroupEntity = await api.getGroupEntityFromAPI(
        constants.RHSSO76_GROUPS["group_2"].name,
      );

      expect(
        group2.spec.members.includes(
          constants.RHSSO76_USERS["user_2"].username,
        ),
      ).toBe(true);
      expect(
        group2.spec.children.includes(constants.RHSSO76_NESTED_GROUP.name),
      ).toBe(true);

      // group_nested should show user_3
      const group3: GroupEntity = await api.getGroupEntityFromAPI(
        constants.RHSSO76_NESTED_GROUP.name,
      );

      expect(
        group3.spec.members.includes(
          constants.RHSSO76_USERS["user_3"].username,
        ),
      ).toBe(true);

      // group_4 should show user_3
      const group4: GroupEntity = await api.getGroupEntityFromAPI(
        constants.RHSSO76_GROUPS["group_4"].name,
      );

      expect(
        group4.spec.members.includes(
          constants.RHSSO76_USERS["user_3"].username,
        ),
      ).toBe(true);

      expect(
        group4.spec.members.includes(
          constants.RHSSO76_USERS["user_4"].username,
        ),
      ).toBe(true);
    });

    test(` ${version} - remove user from ${version}`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      await rhssoHelper.deleteUser(usersCreated["user_1"].id);
      await page.waitForTimeout(2000); // give rhsso a few seconds
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_1"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );

      await uiHelper.verifyAlertErrorMessage(/Login failed/gm);

      await waitForNextSync("rhsso", syntTime);

      await expect(async () => {
        expect(
          await common.CheckUserIsIngestedInCatalog(
            [
              rhssoHelper.getRHSSOUserDisplayName(
                constants.RHSSO76_USERS["user_1"],
              ),
            ],
            constants.STATIC_API_TOKEN,
          ),
        ).toBe(false);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      const api = new APIHelper();
      api.UseStaticToken(constants.STATIC_API_TOKEN);

      await expect(async () => {
        const group1: GroupEntity = await api.getGroupEntityFromAPI(
          constants.RHSSO76_GROUPS["group_1"].name,
        );
        expect(
          group1.spec.members.includes(
            constants.RHSSO76_USERS["user_1"].username,
          ),
        ).toBe(false);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });
    });

    test(`${version} - move a user to another group in ${version}`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      // move a user to another group -> ensure user can still login
      // move user_3 to group_3

      await rhssoHelper.removeUserFromGroup(
        usersCreated["user_3"].id,
        groupsCreated["group_4"].id,
      );
      await rhssoHelper.addUserToGroup(
        usersCreated["user_3"].id,
        groupsCreated["location_admin"].id,
      );

      const api = new APIHelper();
      api.UseStaticToken(constants.STATIC_API_TOKEN);
      let apiToken: string;

      await expect(async () => {
        await common.keycloakLogin(
          constants.RHSSO76_USERS["user_3"].username,
          constants.RHSSO76_DEFAULT_PASSWORD,
        );

        apiToken = await RhdhAuthUiHack.getInstance().getApiToken(page);
        expect(apiToken).not.toBeUndefined();

        const statusBefore = await api.scheduleEntityRefreshFromAPI(
          "example",
          "location",
          apiToken,
        );
        LOGGER.info(
          `Checking user can schedule location refresh. API returned ${JSON.stringify(statusBefore)}`,
        );
        expect(statusBefore).toBe(403);

        // logout
        await uiHelper.openSidebar("Settings");
        await common.signOut();
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 90 * 1000,
      });

      await waitForNextSync("rhsso", syntTime);

      // ensure the change is mirrored in the catalog
      // location_admin should show user_3
      await expect(async () => {
        const group3: GroupEntity = await api.getGroupEntityFromAPI(
          constants.RHSSO76_GROUPS["location_admin"].name,
        );
        expect(
          group3.spec.members?.includes(
            constants.RHSSO76_USERS["user_3"].username,
          ),
        ).toBe(true);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      // configure policy permissions different for the two groups
      // after the sync, ensure the permission also reflect the user move
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_3"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );

      // check RBAC permissions are updated after group update
      // new group should allow user to schedule location refresh and unregister the entity
      await expect(async () => {
        await page.goto("/");
        await uiHelper.verifyHeading("Welcome");

        apiToken = await RhdhAuthUiHack.getInstance().getApiToken(page);
        expect(apiToken).not.toBeNull();
        const statusAfter = await api.scheduleEntityRefreshFromAPI(
          "example",
          "location",
          apiToken,
        );
        LOGGER.info(
          `Checking user can schedule location refresh. API returned ${statusAfter}`,
        );
        expect(statusAfter).toBe(200);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      await uiHelper.openSidebar("Settings");
      await common.signOut();
    });

    test(`${version}  - remove a group from ${version}`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      // remove a group -> ensure group and its members still exists, member should still login
      // remove group_3

      await rhssoHelper.deleteGroup(groupsCreated["group_4"].id);

      // user_4 should login
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_4"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );

      await uiHelper.openSidebar("Settings");
      await common.signOut();

      // group_4 should exist in rhdh
      const api = new APIHelper();
      api.UseStaticToken(constants.STATIC_API_TOKEN);

      await expect(async () => {
        const group4: GroupEntity = await api.getGroupEntityFromAPI(
          constants.RHSSO76_GROUPS["group_4"].name,
        );
        expect(
          group4.spec.members.includes(
            constants.RHSSO76_USERS["user_4"].username,
          ),
        ).toBe(true);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      // waiting for next sync
      await waitForNextSync("rhsso", syntTime);

      // after the sync ensure the group entity is removed
      // group_4 should not be in the catalog anymore
      await expect(async () => {
        expect(
          await common.CheckGroupIsIngestedInCatalog(
            [constants.RHSSO76_GROUPS["group_4"].name],
            constants.STATIC_API_TOKEN,
          ),
        ).toBe(false);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      // users permission based on that group will be defaulted to read-only
      // expect user not to see catalog entities
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_4"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );

      await expect(async () => {
        await page.goto("/");
        const navMyGroup = page.locator(`nav a:has-text("My Group")`);
        await expect(navMyGroup).toHaveCount(0);
      }).toPass({
        intervals: [2_000, 5_000],
        timeout: 30 * 1000,
      });

      await uiHelper.openSidebar("Settings");
      await common.signOut();
    });

    test(`${version} - remove a user from RHDH`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      await common.UnregisterUserEntityFromCatalog(
        constants.RHSSO76_USERS["user_4"].username,
        constants.STATIC_API_TOKEN,
      );

      await expect(async () => {
        expect(
          await common.CheckUserIsIngestedInCatalog(
            [
              rhssoHelper.getRHSSOUserDisplayName(
                constants.RHSSO76_USERS["user_4"],
              ),
            ],
            constants.STATIC_API_TOKEN,
          ),
        ).toBe(false);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      // expect entity is not found in rhdh
      const loginSucceded = await common.keycloakLogin(
        constants.RHSSO76_USERS["user_4"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );
      expect(loginSucceded).toContain("Login successful");

      await uiHelper.verifyAlertErrorMessage(
        /Login failed; caused by Error: Failed to sign-in, unable to resolve user identity/gm,
      );

      // clear user sessions
      await rhssoHelper.clearUserSessions(
        constants.RHSSO76_USERS["user_4"].username,
        constants.AUTH_PROVIDERS_REALM_NAME,
      );

      await waitForNextSync("rhsso", syntTime);

      // user_4 should login
      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_4"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );

      await uiHelper.openSidebar("Settings");
      await common.signOut();
    });

    test(`${version} - remove a group from RHDH`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      await common.UnregisterGroupEntityFromCatalog(
        constants.RHSSO76_GROUPS["group_3"].name,
        constants.STATIC_API_TOKEN,
      );

      await expect(async () => {
        expect(
          await common.CheckGroupIsIngestedInCatalog(
            [constants.RHSSO76_GROUPS["group_3"].name],
            constants.STATIC_API_TOKEN,
          ),
        ).toBe(false);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      await waitForNextSync("rhsso", syntTime);

      // after sync, ensure group is created again and memembers can login
      await expect(async () => {
        expect(
          await common.CheckGroupIsIngestedInCatalog(
            [constants.RHSSO76_GROUPS["group_3"].name],
            constants.STATIC_API_TOKEN,
          ),
        ).toBe(true);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });
    });

    test(`${version} - rename a user and a group`, async () => {
      test.setTimeout(300 * 1000);
      LOGGER.info(`Executing testcase: ${test.info().title}`);

      await rhssoHelper.updateUser(usersCreated["user_2"].id, {
        lastName: constants.RHSSO76_USERS["user_2"].lastName + " Renamed",
        emailVerified: true,
        email: constants.RHSSO76_USERS["user_2"].username + "@rhdh.com",
      });

      await rhssoHelper.updateGruop(groupsCreated["group_2"].id, {
        name: constants.RHSSO76_GROUPS["group_2"].name + "_renamed",
      });

      // waiting for next sync
      await waitForNextSync("rhsso", syntTime);

      // after sync, ensure group is mirrored
      // after sync, ensure user change is mirrorred
      await expect(async () => {
        expect(
          await common.CheckGroupIsIngestedInCatalog(
            [constants.RHSSO76_GROUPS["group_2"].name + "_renamed"],
            constants.STATIC_API_TOKEN,
          ),
        ).toBe(true);
      }).toPass({
        intervals: [1_000, 2_000, 5_000],
        timeout: 60 * 1000,
      });

      await common.keycloakLogin(
        constants.RHSSO76_USERS["user_2"].username,
        constants.RHSSO76_DEFAULT_PASSWORD,
      );

      // users permission based on that group will be defaulted to read-only
      // expect user not to see catalog entities
      await expect(async () => {
        await page.goto("/");
        const navMyGroup = page.locator(`nav a:has-text("My Group")`);
        await expect(navMyGroup).toHaveCount(0);
      }).toPass({
        intervals: [2_000, 5_000],
        timeout: 30 * 1000,
      });

      // update the policy with the new group name
      await replaceInRBACPolicyFileConfigMap(
        "rbac-policy",
        constants.AUTH_PROVIDERS_NAMESPACE,
        constants.RHSSO76_GROUPS["group_2"].name,
        constants.RHSSO76_GROUPS["group_2"].name + "_renamed",
      );

      await uiHelper.openSidebar("Settings");
      // user should see the entities again
      await expect(async () => {
        await page.reload();
        LOGGER.info(
          "Reloading page, permission should be updated automatically.",
        );
        await expect(page.locator(`nav a:has-text("My Group")`)).toBeVisible({
          timeout: 2000,
        });
      }).toPass({
        intervals: [5_000, 10_000],
        timeout: 120 * 1000,
      });

      await uiHelper.openSidebar("My Group");
      await uiHelper.verifyHeading(
        constants.RHSSO76_GROUPS["group_2"].name + "_renamed",
      );

      await uiHelper.openSidebar("Settings");
      await common.signOut();
    });

    test.afterEach(async () => {
      if (test.info().status !== test.info().expectedStatus) {
        const prefix = `${test.info().testId}_${test.info().retry}`;
        LOGGER.info(`Dumping logs with prefix ${prefix}`);
        await dumpAllPodsLogs(prefix, constants.LOGS_FOLDER);
        await dumpRHDHUsersAndGroups(prefix, constants.LOGS_FOLDER);
        mustSync = true;
      }
    });

    test.beforeEach(async () => {
      test.setTimeout(120 * 1000);
      if (test.info().retry > 0 || mustSync) {
        LOGGER.info(
          `Waiting for sync. Retry #${test.info().retry}. Needed sync after failure: ${mustSync}.`,
        );
        await waitForNextSync("rhsso", syntTime);
        mustSync = false;
      }
    });
  });
}
