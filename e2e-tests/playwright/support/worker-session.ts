import type { TestInfo } from "@playwright/test";

const workerCleanups = new Map<number, Array<() => Promise<void>>>();

/** Run and clear all registered cleanups for the current worker. */
export async function runWorkerCleanups(testInfo: TestInfo): Promise<void> {
  const cleanups = workerCleanups.get(testInfo.workerIndex) ?? [];
  workerCleanups.delete(testInfo.workerIndex);

  for (const cleanup of cleanups.toReversed()) {
    await cleanup();
  }
}
