import { request, type APIResponse } from "@playwright/test";

export * from "./catalog";
export * from "./github";

export async function APIRequestWithStaticToken(
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
