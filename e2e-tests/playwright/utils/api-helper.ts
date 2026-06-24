import { type GroupEntity, type UserEntity } from "@backstage/catalog-model";
import { request, type APIResponse, expect } from "@playwright/test";

import * as catalogApi from "./api-helper-catalog";
import * as githubApi from "./api-helper-github";
import {
  isGuestTokenResponse,
  isGroupEntity,
  isUserEntity,
  parseJsonResponse,
} from "./api-helper-guards";

export class APIHelper {
  private staticToken = "";
  private baseUrl = "";
  useStaticToken = false;

  static githubRequest = githubApi.githubRequest;
  static createGitHubRepo = githubApi.createGitHubRepo;
  static createGitHubRepoWithFile = githubApi.createGitHubRepoWithFile;
  static createFileInRepo = githubApi.createFileInRepo;
  static initCommit = githubApi.initCommit;
  static deleteGitHubRepo = githubApi.deleteGitHubRepo;
  static mergeGitHubPR = githubApi.mergeGitHubPR;
  static getGitHubPRs = githubApi.getGitHubPRs;
  static getfileContentFromPR = githubApi.getfileContentFromPR;
  static getGithubPaginatedRequest = githubApi.getGithubPaginatedRequest;

  static getEntityUidByName = catalogApi.getEntityUidByName;
  static deleteLocationByUid = catalogApi.deleteLocationByUid;
  static getTemplateEntityUidByName = catalogApi.getTemplateEntityUidByName;
  static deleteEntityLocationById = catalogApi.deleteEntityLocationById;
  static registerLocation = catalogApi.registerLocation;
  static getLocationIdByTarget = catalogApi.getLocationIdByTarget;

  async getGuestToken(): Promise<string> {
    const context = await request.newContext();
    const response = await context.post("/api/auth/guest/refresh");
    expect(response.status()).toBe(200);
    const data: unknown = await parseJsonResponse(response);
    if (!isGuestTokenResponse(data)) {
      throw new Error("Guest token not found in response body");
    }
    return data.backstageIdentity.token;
  }

  async getGuestAuthHeader(): Promise<{ [key: string]: string }> {
    const token = await this.getGuestToken();
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    return headers;
  }

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

  async getAllCatalogLocationsFromAPI(): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-query?orderField=metadata.name%2Casc&filter=kind%3Dlocation`;
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

  async deleteUserEntityFromAPI(user: string): Promise<string | undefined> {
    const r = await this.getCatalogUserFromAPI(user);
    const uid = r.metadata?.uid;
    if (uid === undefined || uid === "") {
      return undefined;
    }
    const url = `${this.baseUrl}/api/catalog/entities/by-uid/${uid}`;
    const response = await APIHelper.APIRequestWithStaticToken("DELETE", url, this.getAuthToken());
    return response.statusText();
  }

  async getCatalogGroupFromAPI(group: string): Promise<GroupEntity> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/group/default/${group}`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    const body: unknown = await parseJsonResponse(response);
    if (!isGroupEntity(body)) {
      throw new TypeError(`Invalid catalog group response for ${group}`);
    }
    return body;
  }

  async deleteGroupEntityFromAPI(group: string): Promise<string> {
    const r = await this.getCatalogGroupFromAPI(group);
    const url = `${this.baseUrl}/api/catalog/entities/by-uid/${r.metadata.uid}`;
    const response = await APIHelper.APIRequestWithStaticToken("DELETE", url, this.getAuthToken());
    return response.statusText();
  }

  async scheduleEntityRefreshFromAPI(entity: string, kind: string, token: string) {
    const url = `${this.baseUrl}/api/catalog/refresh`;
    const reqBody = { entityRef: `${kind}:default/${entity}` };
    const responseRefresh = await APIHelper.APIRequestWithStaticToken("POST", url, token, reqBody);
    return responseRefresh.status();
  }
}
