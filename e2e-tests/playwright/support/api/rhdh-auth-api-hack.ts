import { Page } from "@playwright/test";

// here, we spy on the request to get the Backstage token to use APIs
export class RhdhAuthApiHack {
  static token: string;

  static async getToken(page: Page, provider: "oidc" = "oidc") {
    try {
      const response = await page.request.get(
        `/api/auth/${provider}/refresh?optional=&scope=&env=development`,
        {
          headers: {
            "x-requested-with": "XMLHttpRequest",
          },
        },
      );

      if (!response.ok()) {
        throw new Error(`HTTP error! Status: ${response.status()}`);
      }

      const body = await response.json();

      if (
        body &&
        body.backstageIdentity &&
        typeof body.backstageIdentity.token === "string"
      ) {
        RhdhAuthApiHack.token = body.backstageIdentity.token;
        return RhdhAuthApiHack.token;
      } else {
        throw new Error("Token not found in response body");
      }
    } catch (error) {
      console.error("Failed to retrieve the token:", error);

      throw error;
    }
  }
}
