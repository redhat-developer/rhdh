import { unlinkSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { InstallException } from './errors.js';
import { log } from './log.js';

const POLL_INTERVAL_MS = 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Acquire an exclusive lock file. If the file exists we wait (polling every
 * second) until it disappears, then try to create it atomically with the
 * `wx` flag. Bounded by `DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS` (default 10 min)
 * so a stale lock from a `kill -9`'d process doesn't wedge the init container
 * forever — override via env var.
 */
export async function createLock(lockPath: string): Promise<void> {
  const timeoutMs = parseLockTimeout(process.env.DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' });
      log(`======= Created lock file: ${lockPath}`);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (Date.now() >= deadline) {
      throw new InstallException(
        `Timed out after ${timeoutMs}ms waiting for lock file ${lockPath}. ` +
          `Another install may be stuck — remove the file manually to proceed.`,
      );
    }
    log(`======= Waiting for lock to be released: ${lockPath}`);
    await waitForPath(lockPath, deadline);
  }
}

function parseLockTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_LOCK_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_LOCK_TIMEOUT_MS;
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

async function waitForPath(lockPath: string, deadline: number): Promise<void> {
  for (;;) {
    try {
      await fs.access(lockPath);
    } catch {
      return; // gone
    }
    if (Date.now() >= deadline) return;
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
