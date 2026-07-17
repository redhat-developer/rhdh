import { type UserEntity } from "@backstage/catalog-model";
import { request, type APIResponse } from "@playwright/test";

import * as catalogApi from "./catalog";
import * as githubApi from "./github";
import { isUserEntity, parseJsonResponse } from "./guards";

export class APIHelper {
  private staticToken = "";
  private baseUrl = "";
  useStaticToken = false;

  static githubRequest = githubApi.githubRequest;
  static getGitHubPRs = githubApi.getGitHubPRs;

  static getTemplateEntityUidByName = catalogApi.getTemplateEntityUidByName;
  static deleteEntityLocationById = catalogApi.deleteEntityLocationById;
  static registerLocation = catalogApi.registerLocation;
  static getLocationIdByTarget = catalogApi.getLocationIdByTarget;

  UseStaticToken(token: string): void {
    this.useStaticToken = true;
    this.staticToken = "Bearer " + token;
  }

  UseBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  static async APIRequestWithStaticToken(
    method: string,
    url: string,
    staticToken: string,
    body?: string | object,
  ): Promise<APIResponse> {
    const context = await request.newContext();
    const options: {
      method: string;
      headers: {
        Accept: string;
        Authorization: string;
      };
      data?: string | object;
    } = {
      method: method,
      headers: {
        Accept: "application/json",
        Authorization: staticToken,
      },
    };

    if (body !== undefined) {
      options.data = body;
    }

    const response = await context.fetch(url, options);
    return response;
  }

  private getAuthToken(): string {
    return this.useStaticToken ? this.staticToken : "";
  }

  async getAllCatalogUsersFromAPI(): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-query?orderField=metadata.name%2Casc&filter=kind%3Duser`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    return parseJsonResponse(response);
  }

  async getAllCatalogGroupsFromAPI(): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-query?orderField=metadata.name%2Casc&filter=kind%3Dgroup`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    return parseJsonResponse(response);
  }

  async getGroupEntityFromAPI(group: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/group/default/${group}`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    return parseJsonResponse(response);
  }

  async getCatalogUserFromAPI(user: string): Promise<UserEntity> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/user/default/${user}`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    const body: unknown = await parseJsonResponse(response);
    if (!isUserEntity(body)) {
      throw new TypeError(`Invalid catalog user response for ${user}`);
    }
    return body;
  }
}
