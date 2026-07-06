// Jira: RHIDP-13243 — Playwright page.coverage collection for rhdh E2E specs
// Feature umbrella: RHDHPLAN-851, Epic: RHIDP-13242
//
// Extended `test` that auto-collects V8 JS coverage from Chromium during each
// spec when the env var COLLECT_COVERAGE=true is set. With the env var unset
// (the default), this behaves exactly like the base `@playwright/test` and
// adds no measurable overhead.
//
// Usage in a spec using the built-in { page } fixture:
//   import { test, expect } from "@support/coverage/test";
//
// For serial specs that share one browser context across a describe block,
// use the worker-scoped fixtures instead of manual beforeAll setup:
//   test.beforeAll(async ({ rhdhPage, rhdhContext }) => { ... });
//
// For specs that create their own context/page via browser.newContext(),
// import the helpers directly and call them around the test body:
//   import { startCoverageForPage, stopCoverageForPage } from "@support/coverage/test";
//
// Everything else (describe, it, assertions) stays identical.

import {
  test as baseTest,
  expect as baseExpect,
  type BrowserContext,
  type Page,
  type WorkerInfo,
} from "@playwright/test";
import { AuthProviderSession } from "../auth/provider-auth";
import { signInAsGuest } from "../auth/guest-auth";
import { createBrowserSession } from "../browser-session";
import { runWorkerCleanups } from "../worker-session";
import { startCoverageForPage, stopCoverageForPage } from "./instrumentation";

// Re-export all Playwright types and values so specs can replace
// `from "@playwright/test"` with this module. The locally-defined `test`
// and `expect` below shadow the star re-exports.
export * from "@playwright/test";
export { startCoverageForPage, stopCoverageForPage } from "./instrumentation";

// Re-exported Playwright names keep their original casing so specs can opt in
// with the idiomatic `import { test, expect } from "..."` pattern. The project
// naming rule requires UPPER_CASE for exported const, but shadowing the
// Playwright convention would force every consumer to alias — worse DX.
type RhdhBrowserWorkerFixtures = {
  rhdhContext: BrowserContext;
  rhdhPage: Page;
  rhdhGuestPage: Page;
  rhdhAuthSession: AuthProviderSession;
};

type RhdhPerTestFixtures = {
  guestPage: Page;
  authSession: AuthProviderSession;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = baseTest.extend<RhdhPerTestFixtures, RhdhBrowserWorkerFixtures>(
  {
    page: async ({ page }, use, testInfo) => {
      await startCoverageForPage(page);
      await use(page);
      await stopCoverageForPage(page, testInfo);
    },
    guestPage: async ({ page }, use) => {
      await signInAsGuest(page);
      await use(page);
    },
    authSession: async ({ page }, use) => {
      await use(new AuthProviderSession(page));
    },
    rhdhContext: [
      async ({ browser }, use, workerInfo: WorkerInfo) => {
        const session = await createBrowserSession(browser);
        await use(session.context);
        await runWorkerCleanups(workerInfo);
        await session.teardown(workerInfo);
      },
      { scope: "worker" },
    ],
    rhdhPage: [
      async ({ rhdhContext }, use) => {
        const existingPage = rhdhContext.pages()[0];
        const page = existingPage ?? (await rhdhContext.newPage());
        await use(page);
      },
      { scope: "worker" },
    ],
    rhdhGuestPage: [
      async ({ rhdhPage }, use) => {
        await signInAsGuest(rhdhPage);
        await use(rhdhPage);
      },
      { scope: "worker" },
    ],
    rhdhAuthSession: [
      async ({ rhdhPage }, use) => {
        await use(new AuthProviderSession(rhdhPage));
      },
      { scope: "worker" },
    ],
  },
);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const expect = baseExpect;

export { createBrowserSession, type BrowserSession } from "../browser-session";
export { runWorkerCleanups } from "../worker-session";
