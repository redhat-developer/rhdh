import { CatalogUsersPO } from "../../../support/pageObjects/catalog/catalog-users-obj";
import Keycloak from "../../../utils/keycloak/keycloak";
import { UiHelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { test, expect } from "@playwright/test";

test.describe("Test Keycloak plugin", () => {
  let uiHelper: UiHelper;
  let keycloak: Keycloak;
  let common: Common;
  let token: string;

  test.beforeAll(async () => {
    keycloak = new Keycloak();
    token = await keycloak.getAuthenticationToken();
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UiHelper(page);
    common = new Common(page);
    await common.loginAsGuest();
    await CatalogUsersPO.visitBaseURL(page);
  });

  test("Users on keycloak should match users on backstage", async ({
    page,
  }) => {
    const keycloakUsers = await keycloak.getUsers(token);
    const backStageUsersLocator = await CatalogUsersPO.getListOfUsers(page);
    const backStageUsersCount = await backStageUsersLocator.count();

    expect(keycloakUsers.length).toBeGreaterThan(0);

    for (let i = 0; i < backStageUsersCount; i++) {
      const backStageUser = backStageUsersLocator.nth(i);
      const backStageUserText = await backStageUser.textContent();
      const userFound = keycloakUsers.find(
        (user) => user.username === backStageUserText,
      );
      expect(userFound).not.toBeNull();

      if (userFound) {
        await keycloak.checkUserDetails(
          page,
          userFound,
          token,
          uiHelper,
          keycloak,
        );
      }
    }
  });
});
