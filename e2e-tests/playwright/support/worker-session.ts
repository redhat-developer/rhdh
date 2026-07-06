import type { TestInfo } from "@playwright/test";

/** Minimal scope info for worker-scoped cleanup registration. */
export type WorkerCleanupScope = Pick<TestInfo, "workerIndex">;

const workerCleanups = new Map<number, Array<() => Promise<void>>>();

/** Run and clear all registered cleanups for the current worker. */
export async function runWorkerCleanups(scope: WorkerCleanupScope): Promise<void> {
  const cleanups = workerCleanups.get(scope.workerIndex) ?? [];
  workerCleanups.delete(scope.workerIndex);

  for (const cleanup of cleanups.toReversed()) {
    await cleanup();
  }
}
