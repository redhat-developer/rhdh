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
//   useRhdhBaseURL(instanceUrl); // file top-level — or createAuthProviderHarness()
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
import type { AuthProviderSession } from "../auth/provider-auth";
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
  // Worker-scoped mirror of baseURL for rhdhContext (test.use({ baseURL }) is test-scoped only).
  workerBaseURL: string | undefined;
};

type RhdhPerTestFixtures = {
  guestPage: Page;
  authSession: AuthProviderSession;
};

function resolveWorkerBaseURL(
  workerBaseURL: string | undefined,
  projectBaseURL: string | undefined,
): string | undefined {
  // Treat "" like unset — auth CI intentionally exports empty BASE_URL.
  if (workerBaseURL !== undefined && workerBaseURL !== "") {
    return workerBaseURL;
  }
  if (projectBaseURL !== undefined && projectBaseURL !== "") {
    return projectBaseURL;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = baseTest.extend<RhdhPerTestFixtures, RhdhBrowserWorkerFixtures>(
  {
    page: async ({ page }, use, testInfo) => {
      await startCoverageForPage(page);
      await use(page);
      await stopCoverageForPage(page, testInfo);
    },
    guestPage: async ({ page, locale }, use) => {
      const { signInAsGuest } = await import("../auth/guest-auth");
      const { resolveLocale } = await import("../../e2e/localization/locale");
      await signInAsGuest(page, { locale: resolveLocale(locale) });
      await use(page);
    },
    authSession: async ({ page, locale, baseURL }, use) => {
      const { AuthProviderSession } = await import("../auth/provider-auth");
      const { resolveLocale } = await import("../../e2e/localization/locale");
      await use(new AuthProviderSession(page, resolveLocale(locale), baseURL));
    },
    // Default undefined → fall back to project `use.baseURL` (process.env.BASE_URL).
    // Must be set via file top-level test.use / useRhdhBaseURL — not inside describe.
    workerBaseURL: [undefined, { option: true, scope: "worker" }],
    rhdhContext: [
      async ({ browser, workerBaseURL }, use, workerInfo: WorkerInfo) => {
        const { baseURL: projectBaseURL, locale, ignoreHTTPSErrors } = workerInfo.project.use;
        const baseURL = resolveWorkerBaseURL(workerBaseURL, projectBaseURL);
        const session = await createBrowserSession(browser, {
          baseURL,
          locale,
          ignoreHTTPSErrors,
        });
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
      async ({ rhdhPage }, use, workerInfo: WorkerInfo) => {
        const { signInAsGuest } = await import("../auth/guest-auth");
        const { resolveLocale } = await import("../../e2e/localization/locale");
        await signInAsGuest(rhdhPage, {
          locale: resolveLocale(workerInfo.project.use.locale),
        });
        await use(rhdhPage);
      },
      { scope: "worker" },
    ],
    rhdhAuthSession: [
      async ({ rhdhPage, workerBaseURL }, use, workerInfo: WorkerInfo) => {
        const { AuthProviderSession } = await import("../auth/provider-auth");
        const { resolveLocale } = await import("../../e2e/localization/locale");
        const baseURL = resolveWorkerBaseURL(workerBaseURL, workerInfo.project.use.baseURL);
        await use(
          new AuthProviderSession(rhdhPage, resolveLocale(workerInfo.project.use.locale), baseURL),
        );
      },
      { scope: "worker" },
    ],
  },
);

/**
 * Sets test-scoped `baseURL` and worker-scoped `workerBaseURL` together.
 * Call at file top level (outside `test.describe`) — Playwright rejects
 * worker-scoped options inside a describe group.
 */
export function useRhdhBaseURL(url: string): void {
  test.use({ baseURL: url, workerBaseURL: url });
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const expect = baseExpect;

export { createBrowserSession, type BrowserSession } from "../browser-session";
export { runWorkerCleanups } from "../worker-session";
