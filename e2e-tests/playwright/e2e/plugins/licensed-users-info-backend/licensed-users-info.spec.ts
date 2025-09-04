import { CatalogUsersPO } from "../../../support/page-objects/catalog/catalog-users-obj";
import { RhdhAuthUiHack } from "../../../support/api/rhdh-auth-hack";
import { Common } from "../../../utils/common";
import {
  test,
  expect,
  APIRequestContext,
  APIResponse,
  request,
} from "@playwright/test";
import playwrightConfig from "../../../../playwright.config";

test.describe("Test licensed users info backend plugin", async () => {
  let common: Common;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let apiToken: string;

  const baseRHDHURL: string = playwrightConfig.use.baseURL;
  const pluginAPIURL: string = "api/licensed-users-info/";

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    await common.loginAsGuest();
    await CatalogUsersPO.visitBaseURL(page);

    // Get the api token
    const hacker: RhdhAuthUiHack = RhdhAuthUiHack.getInstance();
    apiToken = await hacker.getApiToken(page);
  });

  test("Test plugin health check endpoint", async () => {
    const requestContext: APIRequestContext = await request.newContext({
      baseURL: `${baseRHDHURL}/${pluginAPIURL}`,
    });

    const response: APIResponse = await requestContext.get("health");
    const result = await response.json();

    /*
      { status: 'ok' }
    */

    expect(result).toHaveProperty("status");
    expect(result.status).toBe("ok");
  });

  test("Test plugin user quantity url", async () => {
    const requestContext: APIRequestContext = await request.newContext({
      baseURL: `${baseRHDHURL}/${pluginAPIURL}`,
      extraHTTPHeaders: {
        Authorization: apiToken,
        Accept: "application/json",
      },
    });

    const response: APIResponse = await requestContext.get("users/quantity");
    const result = await response.json();

    /*
      { quantity: '1' }
    */

    expect(result).toHaveProperty("quantity");
    expect(Number(result.quantity)).toBeGreaterThan(0);
  });

  test("Test plugin users url", async () => {
    const requestContext: APIRequestContext = await request.newContext({
      baseURL: `${baseRHDHURL}/${pluginAPIURL}`,
      extraHTTPHeaders: {
        Authorization: apiToken,
        Accept: "application/json",
      },
    });

    const response: APIResponse = await requestContext.get("users");
    const result = await response.json();

    /*
      [
        {
          userEntityRef: 'user:development/guest',
          lastAuthTime: 'Thu, 17 Jul 2025 17:53:51 GMT'
        }
      ]
    */

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("userEntityRef");
    expect(result[0]).toHaveProperty("lastAuthTime");
    expect(result[0].userEntityRef).toContain("user:");
  });

  test("Test plugin users as a csv url", async () => {
    const requestContext: APIRequestContext = await request.newContext({
      baseURL: `${baseRHDHURL}/${pluginAPIURL}`,
      extraHTTPHeaders: {
        Authorization: apiToken,
        "Content-Type": "text/csv",
      },
    });

    const response: APIResponse = await requestContext.get("users");

    // 'content-type': 'text/csv; charset=utf-8',
    expect(response.headers()["content-type"]).toContain("text/csv");

    // 'content-disposition': 'attachment; filename="data.csv"',
    expect(response.headers()["content-disposition"]).toBe(
      'attachment; filename="data.csv"',
    );

    const result = await response.text();
    /*
      userEntityRef,displayName,email,lastAuthTime
      user:development/guest,undefined,undefined,"Fri, 18 Jul 2025 12:41:47 GMT"
    */
    const splitText = result.split("\n");
    const csvHeaders = splitText[0];
    const csvData = splitText[1];

    expect(csvHeaders).toContain(
      "userEntityRef,displayName,email,lastAuthTime",
    );
    expect(csvData).toContain("user:");
  });
});
