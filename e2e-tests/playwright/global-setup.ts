import { request as playwrightRequest } from "@playwright/test";

import { PW_PROJECT, isProjectSelected } from "./projects";
import { parseProxy } from "./utils/proxy";
import { newRuntimeRunId } from "./utils/runtime-database";
import { ensureRuntimeDeployed } from "./utils/runtime-deploy";
import { prepareRuntimeImages } from "./utils/runtime-images";
import { waitForRhdhReady } from "./utils/wait-for-rhdh-ready";

/**
 * Ensures the deployed RHDH instance responds before any project runs.
 *
 * Deployment modes:
 * - BASE_URL set → wait for that instance (CI or pre-deployed cluster)
 * - BASE_URL unset + RUNTIME_AUTO_DEPLOY=true → deploy showcase-runtime, then wait
 * - Otherwise → no-op (lint-only / cluster-free local harness runs)
 */
export default async function globalSetup(): Promise<void> {
  // Workers (including replacements after a retry) inherit one ownership ID.
  process.env.CLOUDSQL_RUN_ID = newRuntimeRunId();
  process.env.RUNTIME_RUN_ID = process.env.CLOUDSQL_RUN_ID;
  if (
    isProjectSelected(PW_PROJECT.SHOWCASE_RUNTIME) ||
    process.env.RUNTIME_AUTO_DEPLOY === "true"
  ) {
    await prepareRuntimeImages();
  }
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
    // In disconnected environments the CI runner reaches the cluster through a
    // squid proxy (HTTPS_PROXY). Unlike browser contexts which inherit the
    // proxy from playwright.config.ts, APIRequestContext needs it explicitly.
    proxy: parseProxy(process.env.HTTPS_PROXY),
  });
  try {
    await waitForRhdhReady(request);
  } finally {
    await request.dispose();
  }
}
