import User from './user';
import Group from './group';
import { expect, Page } from '@playwright/test';
import { UIhelper } from '../UIhelper';
import { CatalogUsersPO } from '../../support/pageObjects/catalog/catalog-users-obj';
import axios, { Axios } from 'axios';

interface AuthResponse {
  access_token: string;
}
class Keycloak {
  private readonly baseURL: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly myAxios: Axios;

  constructor() {
    this.baseURL = process.env.KEYCLOAK_BASE_URL;
    this.realm = process.env.KEYCLOAK_REALM;
    this.clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
    this.clientId = process.env.KEYCLOAK_CLIENT_ID;
    this.myAxios = axios.create({
      baseURL: this.baseURL,
    });
  }

  async getAuthenticationToken(): Promise<string> {
    const response = await axios.post(
      `/realms/${this.realm}/protocol/openid-connect/token`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
      },
    );

    if (response.status !== 200) throw new Error('Failed to authenticate');
    const data = (await response.data) as AuthResponse;
    return data.access_token;
  }

  async getUsers(authToken: string): Promise<User[]> {
    const response = await this.myAxios.get(
      `/admin/realms/${this.realm}/users`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    if (response.status !== 200) throw new Error('Failed to get users');
    return response.data as Promise<User[]>;
  }

  async getGroupsOfUser(authToken: string, userId: string): Promise<Group[]> {
    const response = await this.myAxios.get(
      `/admin/realms/${this.realm}/users/${userId}/groups`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    if (response.status !== 200)
      throw new Error('Failed to get groups of user');
    return response.data as Promise<Group[]>;
  }

  async checkUserDetails(
    page: Page,
    keycloakUser: User,
    token: string,
    uiHelper: UIhelper,
    keycloak: Keycloak,
  ) {
    await CatalogUsersPO.visitUserPage(page, keycloakUser.username);
    const emailLink = await CatalogUsersPO.getEmailLink(page);
    await expect(emailLink).toBeVisible();
    await uiHelper.verifyDivHasText(
      `${keycloakUser.firstName} ${keycloakUser.lastName}`,
    );

    const groups = await keycloak.getGroupsOfUser(token, keycloakUser.id);
    for (const group of groups) {
      const groupLink = await CatalogUsersPO.getGroupLink(page, group.name);
      await expect(groupLink).toBeVisible();
    }

    await CatalogUsersPO.visitBaseURL(page);
  }
}

export default Keycloak;
