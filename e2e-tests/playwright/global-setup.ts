import { request as playwrightRequest } from "@playwright/test";

import { waitForRhdhReady } from "./utils/wait-for-rhdh-ready";

/**
 * Ensures the deployed RHDH instance responds before any project runs.
 * Skipped when BASE_URL is unset (local lint-only runs).
 */
export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.BASE_URL;
  if (baseURL === undefined || baseURL === "") {
    return;
  }

  const request = await playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  try {
    await waitForRhdhReady(request);
  } finally {
    await request.dispose();
  }
}
