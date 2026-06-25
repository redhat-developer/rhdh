import { Page } from "@playwright/test";

import playwrightConfig from "../../../playwright.config";
import * as navigation from "../../utils/ui-helper/navigation";

//https://redhatquickcourses.github.io/devhub-admin/devhub-admin/1/chapter2/rbac.html#_lab_rbac_rest_api
export class RhdhAuthUiHack {
  private static instance: RhdhAuthUiHack | undefined;
  private token?: string;

  private constructor() {}

  public static getInstance(): RhdhAuthUiHack {
    RhdhAuthUiHack.instance ??= new RhdhAuthUiHack();
    return RhdhAuthUiHack.instance;
  }

  async getApiToken(page: Page): Promise<string> {
    if (this.token === undefined) {
      const apiToken = await this.fetchApiTokenFromPage(page);
      if (apiToken === null || apiToken === "") {
        throw new Error("Failed to obtain API token from page request");
      }
      this.token = apiToken;
    }
    return this.token;
  }

  private async fetchApiTokenFromPage(page: Page): Promise<string | null> {
    const baseURL = playwrightConfig.use?.baseURL;
    if (baseURL === undefined || baseURL === "") {
      throw new Error("playwright.config use.baseURL is not defined");
    }

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url() === `${baseURL}/api/search/query?term=` && request.method() === "GET",
      { timeout: 15000 },
    );
    await navigation.openSidebar(page, "Home");
    const getRequest = await requestPromise;
    const authToken = await getRequest.headerValue("Authorization");
    return authToken;
  }
}
