import { unlinkSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { log } from './log.js';

const POLL_INTERVAL_MS = 1000;

/**
 * Acquire an exclusive lock file. If the file exists we wait (polling every
 * second) until it disappears, then try to create it atomically with the
 * `wx` flag. Mirrors the Python loop — simple, resilient to stale locks
 * released by a sibling process.
 */
export async function createLock(lockPath: string): Promise<void> {
  for (;;) {
    try {
      await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' });
      log(`======= Created lock file: ${lockPath}`);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    log(`======= Waiting for lock to be released: ${lockPath}`);
    await waitForPath(lockPath);
  }
}

export async function removeLock(lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
    log(`======= Removed lock file: ${lockPath}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Register sync best-effort cleanup on process exit / SIGTERM / SIGINT. */
export function registerLockCleanup(lockPath: string): void {
  const cleanup = (): void => {
    try {
      unlinkSync(lockPath);
    } catch {
      /* lock already gone */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
}

async function waitForPath(lockPath: string): Promise<void> {
  for (;;) {
    try {
      await fs.access(lockPath);
    } catch {
      return; // gone
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
