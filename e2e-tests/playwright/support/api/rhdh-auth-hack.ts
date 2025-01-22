import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import playwrightConfig from "../../../playwright.config";

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
      const apiToken = await this._getApiToken(page);
      this.token = apiToken;
    }
    return this.token;
  }

  private async _getApiToken(page: Page) {
    const uiHelper = new UIhelper(page);

    await uiHelper.openSidebar("Catalog");
    const requestPromise = page.waitForRequest(
      (request) =>
        request.url() ===
          `${playwrightConfig.use.baseURL}/api/search/query?term=` &&
        request.method() === "GET",
    );
    await uiHelper.openSidebar("Home");
    const getRequest = await requestPromise;
    const authToken = await getRequest.headerValue("Authorization");
    return authToken;
  }
}
