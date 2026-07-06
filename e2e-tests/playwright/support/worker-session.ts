import type { TestInfo } from "@playwright/test";

const workerCleanups = new Map<number, Array<() => Promise<void>>>();

/** Register a cleanup callback to run when the worker-scoped browser session ends. */
export function registerWorkerCleanup(testInfo: TestInfo, cleanup: () => Promise<void>): void {
  const existing = workerCleanups.get(testInfo.workerIndex) ?? [];
  existing.push(cleanup);
  workerCleanups.set(testInfo.workerIndex, existing);
}

/** Run and clear all registered cleanups for the current worker. */
export async function runWorkerCleanups(testInfo: TestInfo): Promise<void> {
  const cleanups = workerCleanups.get(testInfo.workerIndex) ?? [];
  workerCleanups.delete(testInfo.workerIndex);

  for (const cleanup of cleanups.toReversed()) {
    await cleanup();
  }
}
