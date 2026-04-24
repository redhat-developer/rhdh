// Worker-scoped fixtures for test.describe.serial() blocks.
// Usage: import { test, expect } from "@support/shared-page";

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

// Each Playwright worker runs in its own process, so this flag is per-worker.
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

      // Always record — Playwright's recordVideo has no retain-on-failure mode
      // for manual contexts, so we record unconditionally and delete on success.
      // Tracing is auto-started by Playwright (trace: "on" in config) — only
      // startChunk/stopChunk is needed in _sharedTraceChunk for per-test traces.
      const context = await browser.newContext({
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 720 },
        },
      });

      await use(context);

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
    async ({ sharedContext, sharedPage }, use, testInfo) => {
      await sharedContext.tracing.startChunk({ title: testInfo.title });

      await use();

      const failed =
        testInfo.status !== "passed" && testInfo.status !== "skipped";

      if (failed) {
        workerHadFailure = true;
        try {
          const screenshotPath = testInfo.outputPath("failure.png");
          await sharedPage.screenshot({ path: screenshotPath });
          await testInfo.attach("screenshot", {
            path: screenshotPath,
            contentType: "image/png",
          });
        } catch {
          // Page may have crashed — screenshot unavailable
        }
      }

      const tracePath = testInfo.outputPath("trace.zip");
      await sharedContext.tracing.stopChunk({ path: tracePath });

      await testInfo.attach("trace", {
        path: tracePath,
        contentType: "application/zip",
      });
    },
    { auto: true },
  ],
});

// eslint-disable-next-line @typescript-eslint/naming-convention
export const expect = baseExpect;
