import { request as playwrightRequest } from "@playwright/test";

import { ensureRuntimeDeployed } from "./utils/runtime-deploy";
import { waitForRhdhReady } from "./utils/wait-for-rhdh-ready";

/**
 * Projects that deploy their own RHDH instances during test execution.
 * These must skip the pre-flight health check because no instance exists
 * at BASE_URL until a test file's beforeAll creates one.
 *
 * - showcase-runtime:        deploys via ensureRuntimeDeployed() in config-map.spec.ts
 * - showcase-auth-providers: deploys per-provider via AuthProviderHarness in each spec
 */
const SELF_DEPLOYING_PROJECTS = new Set(["showcase-runtime", "showcase-auth-providers"]);

/**
 * Ensures the deployed RHDH instance responds before any project runs.
 *
 * Deployment modes:
 * - Self-deploying project → no-op (deployment happens in test beforeAll)
 * - BASE_URL unset + RUNTIME_AUTO_DEPLOY=true → deploy showcase-runtime, then wait
 * - BASE_URL set → wait for that instance (CI or pre-deployed cluster)
 * - Otherwise → no-op (lint-only / legacy-local runs)
 */
export default async function globalSetup(): Promise<void> {
  if (SELF_DEPLOYING_PROJECTS.has(process.env.PLAYWRIGHT_PROJECT ?? "")) {
    return;
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
  });
  try {
    await waitForRhdhReady(request);
  } finally {
    await request.dispose();
  }
}
