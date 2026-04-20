import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallException } from '../src/errors';
import { verifyIntegrity } from '../src/integrity';

describe('verifyIntegrity', () => {
  let workDir: string;
  let archive: string;
  const payload = Buffer.from('hello world');

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'integrity-test-'));
    archive = join(workDir, 'pkg.tgz');
    writeFileSync(archive, payload);
  });

  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  const hashB64 = (algo: string) => createHash(algo).update(payload).digest('base64');

  it('accepts a matching sha256 hash', async () => {
    await expect(
      verifyIntegrity('pkg', archive, `sha256-${hashB64('sha256')}`),
    ).resolves.toBeUndefined();
  });

  it('accepts a matching sha512 hash', async () => {
    await expect(
      verifyIntegrity('pkg', archive, `sha512-${hashB64('sha512')}`),
    ).resolves.toBeUndefined();
  });

  it('accepts a matching sha384 hash', async () => {
    await expect(
      verifyIntegrity('pkg', archive, `sha384-${hashB64('sha384')}`),
    ).resolves.toBeUndefined();
  });

  it('rejects missing dash delimiter', async () => {
    await expect(verifyIntegrity('pkg', archive, 'sha256')).rejects.toThrow(InstallException);
  });

  it('rejects an unsupported algorithm', async () => {
    await expect(verifyIntegrity('pkg', archive, `md5-${hashB64('md5')}`)).rejects.toThrow(
      /algorithm md5 is not supported/,
    );
  });

  it('rejects invalid base64', async () => {
    await expect(verifyIntegrity('pkg', archive, 'sha256-not!!base64')).rejects.toThrow(
      /not a valid base64 encoding/,
    );
  });

  it('rejects a hash mismatch', async () => {
    const wrong = createHash('sha256').update('tampered').digest('base64');
    await expect(verifyIntegrity('pkg', archive, `sha256-${wrong}`)).rejects.toThrow(
      /integrity check failed/,
    );
  });
});
