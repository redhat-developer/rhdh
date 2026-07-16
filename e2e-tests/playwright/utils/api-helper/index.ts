import { type UserEntity } from "@backstage/catalog-model";
import { request, type APIResponse } from "@playwright/test";

import * as catalogApi from "./catalog";
import * as githubApi from "./github";
import { isUserEntity, parseJsonResponse } from "./guards";

/**
 * Shared Playwright APIRequest timeout. Default is 10s; RHDH through OpenShift
 * Routes often needs longer for catalog and other authenticated fetches.
 */
export const API_REQUEST_TIMEOUT_MS = 60_000;

/** Alias of API_REQUEST_TIMEOUT_MS for catalog-oriented call sites. */
export const CATALOG_API_TIMEOUT_MS = API_REQUEST_TIMEOUT_MS;

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
    timeoutMs: number = API_REQUEST_TIMEOUT_MS,
  ): Promise<APIResponse> {
    const context = await request.newContext({ timeout: timeoutMs });
    const options: {
      method: string;
      headers: {
        Accept: string;
        Authorization: string;
      };
      data?: string | object;
      timeout: number;
    } = {
      method: method,
      headers: {
        Accept: "application/json",
        Authorization: staticToken,
      },
      timeout: timeoutMs,
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

  private static jsonOrNullOn404(response: APIResponse): Promise<unknown> {
    if (response.status() === 404) {
      return Promise.resolve(null);
    }
    return parseJsonResponse(response);
  }

  /**
   * Fetch a group by name. Returns null on 404 so ingestion polls can
   * wait for the entity; other non-2xx and malformed 200s fail fast.
   */
  async getGroupEntityFromAPI(group: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/group/default/${group}`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    return APIHelper.jsonOrNullOn404(response);
  }

  /**
   * Fetch a user by name. Returns null on 404 so annotation polls can wait;
   * other non-2xx and malformed 200s fail fast.
   */
  async getCatalogUserFromAPI(user: string): Promise<UserEntity | null> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/user/default/${user}`;
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, this.getAuthToken());
    const body = await APIHelper.jsonOrNullOn404(response);
    if (body === null) {
      return null;
    }
    if (!isUserEntity(body)) {
      throw new TypeError(`Invalid catalog user response for ${user}`);
    }
    return body;
  }
}
