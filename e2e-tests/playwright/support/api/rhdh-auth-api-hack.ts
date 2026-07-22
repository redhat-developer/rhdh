import { Page } from "@playwright/test";

interface BackstageRefreshResponse {
  backstageIdentity?: {
    token?: string;
  };
}

function parseRefreshToken(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new Error("Token not found in response body");
  }

  const identity = (body as BackstageRefreshResponse).backstageIdentity;
  if (identity && typeof identity.token === "string") {
    return identity.token;
  }

  throw new Error("Token not found in response body");
}

// here, we spy on the request to get the Backstage token to use APIs
export const RhdhAuthApiHack = {
  token: undefined as string | undefined,

  async getToken(page: Page, provider: "oidc" = "oidc"): Promise<string> {
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

      const body: unknown = await response.json();
      const token = parseRefreshToken(body);
      RhdhAuthApiHack.token = token;
      return token;
    } catch (error) {
      console.error("Failed to retrieve the token:", error);

      throw error;
    }
  },
};
