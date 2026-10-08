import { randomBytes } from "node:crypto";

import { request as playwrightRequest } from "@playwright/test";

import { readCloudSqlInputs } from "./utils/cloudsql-config";
import { parseProxy } from "./utils/proxy";
import { runtimeCoverageRequired, readExternalDatabaseInputs } from "./utils/runtime-database";
import { ensureRuntimeDeployed } from "./utils/runtime-deploy";
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
  process.env.CLOUDSQL_RUN_ID = randomBytes(6).toString("hex");
  process.env.RUNTIME_RUN_ID = process.env.CLOUDSQL_RUN_ID;
  if (process.argv.some((arg) => arg.includes("showcase-runtime")) && runtimeCoverageRequired()) {
    for (const provider of ["rds", "azure"] as const) {
      for (const slot of [1, 2, 3, 4]) readExternalDatabaseInputs(provider, slot);
    }
    readCloudSqlInputs({ ...process.env, CLOUDSQL_REQUIRED: "true" });
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
