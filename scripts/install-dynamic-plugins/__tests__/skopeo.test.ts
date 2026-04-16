import { mkdirSync, writeFileSync, mkdtempSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Skopeo } from '../src/skopeo';

/**
 * Build a fake `skopeo` binary that records every invocation. Used to verify
 * the in-memory caches in `Skopeo.exists/inspect/inspectRaw` actually dedupe
 * forks and the wrapper survives realistic exit codes.
 */
function makeFakeSkopeo(opts: { inspectExitCode?: number; inspectStdout?: string }): {
  binPath: string;
  logPath: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'fake-skopeo-'));
  const binPath = join(dir, 'skopeo');
  const logPath = join(dir, 'invocations.log');
  const exitCode = opts.inspectExitCode ?? 0;
  const stdout = opts.inspectStdout ?? '{"Digest":"sha256:abc"}';
  writeFileSync(
    binPath,
    `#!/bin/sh
echo "$@" >> "${logPath}"
echo '${stdout.replace(/'/g, `'\\''`)}'
exit ${exitCode}
`,
  );
  chmodSync(binPath, 0o755);
  mkdirSync(dir, { recursive: true });
  return { binPath, logPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('Skopeo cache behaviour', () => {
  it('exists() memoizes the result and only forks skopeo once per URL', async () => {
    const { binPath, logPath, cleanup } = makeFakeSkopeo({ inspectExitCode: 0 });
    try {
      const skopeo = new Skopeo(binPath);
      const url = 'docker://example.com/image:1.0';

      const results = await Promise.all([
        skopeo.exists(url),
        skopeo.exists(url),
        skopeo.exists(url),
      ]);
      expect(results).toEqual([true, true, true]);

      // One more sequential call after the cache is populated.
      expect(await skopeo.exists(url)).toBe(true);

      const log = readFileSync(logPath, 'utf8');
      const invocations = log.split('\n').filter(Boolean);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toContain('inspect --no-tags docker://example.com/image:1.0');
    } finally {
      cleanup();
    }
  });

  it('exists() returns false for non-existent images and caches the negative result', async () => {
    const { binPath, logPath, cleanup } = makeFakeSkopeo({ inspectExitCode: 1 });
    try {
      const skopeo = new Skopeo(binPath);
      expect(await skopeo.exists('docker://example.com/missing')).toBe(false);
      expect(await skopeo.exists('docker://example.com/missing')).toBe(false);

      const log = readFileSync(logPath, 'utf8');
      expect(log.split('\n').filter(Boolean)).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});
