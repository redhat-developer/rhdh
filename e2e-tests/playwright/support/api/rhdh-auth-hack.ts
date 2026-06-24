import { Page } from "@playwright/test";

import playwrightConfig from "../../../playwright.config";
import { UIhelper } from "../../utils/ui-helper";

//https://redhatquickcourses.github.io/devhub-admin/devhub-admin/1/chapter2/rbac.html#_lab_rbac_rest_api
export class RhdhAuthUiHack {
  private static instance: RhdhAuthUiHack;
  private token?: string;

  private constructor() {}

  public static getInstance(): RhdhAuthUiHack {
    if (!RhdhAuthUiHack.instance) {
      RhdhAuthUiHack.instance = new RhdhAuthUiHack();
    }
    return RhdhAuthUiHack.instance;
  }

  async getApiToken(page: Page): Promise<string> {
    if (!this.token) {
      const apiToken = await this.fetchApiTokenFromPage(page);
      if (!apiToken) {
        throw new Error("Failed to obtain API token from page request");
      }
      this.token = apiToken;
    }
    return this.token;
  }

  private async fetchApiTokenFromPage(page: Page): Promise<string | null> {
    const uiHelper = new UIhelper(page);
    const baseURL = playwrightConfig.use?.baseURL;
    if (!baseURL) {
      throw new Error("playwright.config use.baseURL is not defined");
    }

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url() === `${baseURL}/api/search/query?term=` && request.method() === "GET",
      { timeout: 15000 },
    );
    await uiHelper.openSidebar("Home");
    const getRequest = await requestPromise;
    const authToken = await getRequest.headerValue("Authorization");
    return authToken;
  }
}
