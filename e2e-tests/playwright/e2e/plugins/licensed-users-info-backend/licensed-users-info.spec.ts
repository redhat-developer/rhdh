import { test, expect, APIRequestContext, APIResponse, request } from "@support/coverage/test";

import playwrightConfig from "../../../../playwright.config";
import { RhdhAuthUiHack } from "../../../support/api/rhdh-auth-hack";
import { CatalogBrowsePage } from "../../../support/pages/catalog-browse-page";

interface HealthResponse {
  status: string;
}

interface QuantityResponse {
  quantity: string;
}

interface LicensedUser {
  userEntityRef: string;
  lastAuthTime: string;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof Reflect.get(value, "status") === "string";
}

function isQuantityResponse(value: unknown): value is QuantityResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof Reflect.get(value, "quantity") === "string";
}

function isLicensedUser(value: unknown): value is LicensedUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    typeof Reflect.get(value, "userEntityRef") === "string" &&
    typeof Reflect.get(value, "lastAuthTime") === "string"
  );
}

function isLicensedUserArray(value: unknown): value is LicensedUser[] {
  return Array.isArray(value) && value.every((item) => isLicensedUser(item));
}

test.describe("Test licensed users info backend plugin", () => {
  let catalogBrowsePage: CatalogBrowsePage;

  test.beforeAll(() => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  let apiToken: string;

  const baseRHDHURL: string = playwrightConfig.use?.baseURL ?? "";
  const pluginAPIURL: string = "api/licensed-users-info/";

  test.beforeEach(async ({ guestPage }) => {
    catalogBrowsePage = new CatalogBrowsePage(guestPage);
    await catalogBrowsePage.openLicensedUsersCatalog();

    const hacker: RhdhAuthUiHack = RhdhAuthUiHack.getInstance();
    apiToken = await hacker.getApiToken(guestPage);
  });

  test("Test plugin health check endpoint", async () => {
    const requestContext: APIRequestContext = await request.newContext({
      baseURL: `${baseRHDHURL}/${pluginAPIURL}`,
    });

    const response: APIResponse = await requestContext.get("health");
    const result: unknown = await response.json();

    /*
      { status: 'ok' }
    */

    expect(isHealthResponse(result)).toBe(true);
    if (isHealthResponse(result)) {
      expect(result.status).toBe("ok");
    }
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
    const result: unknown = await response.json();

    /*
      { quantity: '1' }
    */

    expect(isQuantityResponse(result)).toBe(true);
    if (isQuantityResponse(result)) {
      expect(Number(result.quantity)).toBeGreaterThan(0);
    }
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
    const result: unknown = await response.json();

    /*
      [
        {
          userEntityRef: 'user:development/guest',
          lastAuthTime: 'Thu, 17 Jul 2025 17:53:51 GMT'
        }
      ]
    */

    expect(isLicensedUserArray(result)).toBe(true);
    if (isLicensedUserArray(result)) {
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].userEntityRef).toContain("user:");
    }
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
    expect(response.headers()["content-disposition"]).toBe('attachment; filename="data.csv"');

    const result = await response.text();
    /*
      userEntityRef,displayName,email,lastAuthTime
      user:development/guest,undefined,undefined,"Fri, 18 Jul 2025 12:41:47 GMT"
    */
    const splitText = result.split("\n");
    const csvHeaders = splitText[0];
    const csvData = splitText[1];

    expect(csvHeaders).toContain("userEntityRef,displayName,email,lastAuthTime");
    expect(csvData).toContain("user:");
  });
});
