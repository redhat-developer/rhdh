import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLock, removeLock } from '../src/lock-file';

describe('lock-file', () => {
  let workDir: string;
  beforeEach(() => (workDir = mkdtempSync(join(tmpdir(), 'lock-'))));
  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  it('creates the lock file atomically', async () => {
    const lockPath = join(workDir, 'test.lock');
    await createLock(lockPath);
    expect(existsSync(lockPath)).toBe(true);
    await removeLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('removeLock is a no-op when the file is absent', async () => {
    await expect(removeLock(join(workDir, 'missing.lock'))).resolves.toBeUndefined();
  });

  it('waits until an existing lock is released, then acquires it', async () => {
    const lockPath = join(workDir, 'wait.lock');
    writeFileSync(lockPath, 'other-pid');

    const acquired = createLock(lockPath);
    // Simulate the other process releasing after a short delay.
    setTimeout(() => removeLock(lockPath), 50);
    await expect(acquired).resolves.toBeUndefined();
    expect(existsSync(lockPath)).toBe(true);
  });

  it('times out when the existing lock is never released', async () => {
    const lockPath = join(workDir, 'stale.lock');
    writeFileSync(lockPath, 'other-pid');
    const prev = process.env.DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS;
    process.env.DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS = '50';
    try {
      await expect(createLock(lockPath)).rejects.toThrow(/Timed out.*waiting for lock/);
    } finally {
      if (prev === undefined) delete process.env.DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS;
      else process.env.DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS = prev;
    }
  });
});
