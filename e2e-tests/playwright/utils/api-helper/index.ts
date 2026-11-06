import { request, type APIResponse } from "@playwright/test";

import * as catalogApi from "./catalog";
import * as githubApi from "./github";

export class APIHelper {
  static githubRequest = githubApi.githubRequest;
  static getGitHubPRs = githubApi.getGitHubPRs;

  static getTemplateEntityUidByName = catalogApi.getTemplateEntityUidByName;
  static deleteEntityLocationById = catalogApi.deleteEntityLocationById;
  static registerLocation = catalogApi.registerLocation;
  static getLocationIdByTarget = catalogApi.getLocationIdByTarget;

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
}
