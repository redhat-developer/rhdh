// Worker-scoped fixtures that share a single BrowserContext and Page across
// all tests in a test.describe.serial() block. Unlike manual browser.newContext(),
// these fixtures integrate with Playwright's video recording and tracing.
//
// Usage:
//   import { test, expect } from "@support/shared-page";
//
// Then use sharedPage in test.beforeAll and individual test bodies:
//   test.beforeAll(async ({ sharedPage }) => { ... });
//   test("foo", async ({ sharedPage }) => { ... });

import {
  test as baseTest,
  expect as baseExpect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

type TestFixtures = {
  _sharedTraceChunk: void;
};

type WorkerFixtures = {
  sharedContext: BrowserContext;
  sharedPage: Page;
};

let workerHadFailure = false;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = baseTest.extend<TestFixtures, WorkerFixtures>({
  sharedContext: [
    async ({ browser }, use, workerInfo) => {
      const videoDir = path.join(
        "test-results",
        `shared-worker-${workerInfo.workerIndex}`,
        "videos",
      );

      const context = await browser.newContext({
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 720 },
        },
      });

      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });

      await use(context);

      await context.tracing.stop();
      await context.close();

      // Retain-on-failure: delete video files when all tests passed
      if (!workerHadFailure && fs.existsSync(videoDir)) {
        fs.rmSync(videoDir, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],

  sharedPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      await use(page);
    },
    { scope: "worker" },
  ],

  _sharedTraceChunk: [
    async ({ sharedContext }, use, testInfo) => {
      await sharedContext.tracing.startChunk({ title: testInfo.title });

      await use();

      const tracePath = testInfo.outputPath("trace.zip");
      await sharedContext.tracing.stopChunk({ path: tracePath });

      await testInfo.attach("trace", {
        path: tracePath,
        contentType: "application/zip",
      });

      if (testInfo.status !== "passed" && testInfo.status !== "skipped") {
        workerHadFailure = true;
      }
    },
    { auto: true },
  ],
});

// eslint-disable-next-line @typescript-eslint/naming-convention
export const expect = baseExpect;
