import type { TestInfo } from "@playwright/test";

/** Minimal scope info for worker-scoped cleanup registration. */
export type WorkerCleanupScope = Pick<TestInfo, "workerIndex">;

const workerCleanups = new Map<number, Array<() => Promise<void>>>();

/** Register a cleanup callback to run when the worker-scoped browser session tears down. */
export function registerWorkerCleanup(
  scope: WorkerCleanupScope,
  cleanup: () => Promise<void>,
): void {
  const cleanups = workerCleanups.get(scope.workerIndex) ?? [];
  cleanups.push(cleanup);
  workerCleanups.set(scope.workerIndex, cleanups);
}

/** Run and clear all registered cleanups for the current worker. */
export async function runWorkerCleanups(scope: WorkerCleanupScope): Promise<void> {
  const cleanups = workerCleanups.get(scope.workerIndex) ?? [];
  workerCleanups.delete(scope.workerIndex);

  for (const cleanup of cleanups.toReversed()) {
    await cleanup();
  }
}
