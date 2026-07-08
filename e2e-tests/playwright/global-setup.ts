import { request as playwrightRequest } from "@playwright/test";

import { ensureRuntimeDeployed } from "./utils/runtime-deploy";
import { waitForRhdhReady } from "./utils/wait-for-rhdh-ready";

/**
 * Ensures the deployed RHDH instance responds before any project runs.
 *
 * Deployment modes:
 * - BASE_URL set → wait for that instance (CI or pre-deployed cluster)
 * - BASE_URL unset + RUNTIME_AUTO_DEPLOY=true → deploy showcase-runtime, then wait
 * - Otherwise → no-op (lint-only / legacy-local runs)
 */
export default async function globalSetup(): Promise<void> {
  if (
    (process.env.BASE_URL === undefined || process.env.BASE_URL === "") &&
    process.env.RUNTIME_AUTO_DEPLOY === "true"
  ) {
    await ensureRuntimeDeployed();
  }

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
