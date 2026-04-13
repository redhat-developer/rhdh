import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { InstallException } from '../src/errors';
import { extractNpmPackage, extractOciPlugin } from '../src/tar-extract';

const PAYLOAD_LIMIT = 20_000_000;

async function makeTarball(
  archivePath: string,
  entries: string[],
  prep: (root: string) => Promise<void> | void,
): Promise<void> {
  const stageDir = mkdtempSync(join(tmpdir(), 'tar-stage-'));
  try {
    await prep(stageDir);
    await tar.c({ file: archivePath, cwd: stageDir, portable: true }, entries);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

describe('extractOciPlugin', () => {
  let workDir: string;
  let tarball: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'oci-extract-'));
    tarball = join(workDir, 'layer.tar');
  });
  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  it('extracts just the requested plugin subdirectory', async () => {
    await makeTarball(tarball, ['plugin-one', 'plugin-two'], stage => {
      require('node:fs').mkdirSync(join(stage, 'plugin-one'));
      require('node:fs').mkdirSync(join(stage, 'plugin-two'));
      writeFileSync(join(stage, 'plugin-one/index.js'), 'module.exports = 1');
      writeFileSync(join(stage, 'plugin-two/index.js'), 'module.exports = 2');
    });

    const dest = join(workDir, 'out');
    await extractOciPlugin(tarball, 'plugin-one', dest);

    expect(existsSync(join(dest, 'plugin-one/index.js'))).toBe(true);
    expect(existsSync(join(dest, 'plugin-two'))).toBe(false);
  });

  it("rejects plugin paths containing '..'", async () => {
    await makeTarball(tarball, ['plugin-one'], stage => {
      require('node:fs').mkdirSync(join(stage, 'plugin-one'));
      writeFileSync(join(stage, 'plugin-one/index.js'), 'x');
    });
    await expect(extractOciPlugin(tarball, '../etc/passwd', workDir)).rejects.toBeInstanceOf(
      InstallException,
    );
  });

  it('rejects absolute plugin paths', async () => {
    await makeTarball(tarball, ['plugin-one'], stage => {
      require('node:fs').mkdirSync(join(stage, 'plugin-one'));
      writeFileSync(join(stage, 'plugin-one/index.js'), 'x');
    });
    await expect(extractOciPlugin(tarball, '/etc/passwd', workDir)).rejects.toBeInstanceOf(
      InstallException,
    );
  });

  it('raises when any entry exceeds MAX_ENTRY_SIZE', async () => {
    await makeTarball(tarball, ['plugin-one'], stage => {
      require('node:fs').mkdirSync(join(stage, 'plugin-one'));
      const bigPath = join(stage, 'plugin-one/big.bin');
      const fd = require('node:fs').openSync(bigPath, 'w');
      require('node:fs').ftruncateSync(fd, PAYLOAD_LIMIT + 1);
      require('node:fs').closeSync(fd);
    });
    await expect(extractOciPlugin(tarball, 'plugin-one', join(workDir, 'out'))).rejects.toThrow(
      /Zip bomb/,
    );
  });

  it('skips symlinks whose target escapes the destination', async () => {
    await makeTarball(tarball, ['plugin-one'], stage => {
      require('node:fs').mkdirSync(join(stage, 'plugin-one'));
      writeFileSync(join(stage, 'plugin-one/ok.txt'), 'ok');
      symlinkSync('/etc/passwd', join(stage, 'plugin-one/bad-link'));
    });
    const dest = join(workDir, 'out');
    await extractOciPlugin(tarball, 'plugin-one', dest);
    expect(existsSync(join(dest, 'plugin-one/ok.txt'))).toBe(true);
    expect(existsSync(join(dest, 'plugin-one/bad-link'))).toBe(false);
  });
});

describe('extractNpmPackage', () => {
  let workDir: string;
  beforeEach(() => (workDir = mkdtempSync(join(tmpdir(), 'npm-extract-'))));
  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  it("strips the 'package/' prefix and returns the pkg directory name", async () => {
    const archive = join(workDir, 'pkg.tgz');
    await makeTarball(archive, ['package'], stage => {
      require('node:fs').mkdirSync(join(stage, 'package'));
      writeFileSync(join(stage, 'package/package.json'), '{"name":"x"}');
      writeFileSync(join(stage, 'package/index.js'), 'module.exports={};');
    });

    const dir = await extractNpmPackage(archive);
    expect(dir).toBe('pkg');
    expect(readFileSync(join(workDir, 'pkg', 'package.json'), 'utf8')).toBe('{"name":"x"}');
  });

  it("rejects archives with entries outside 'package/'", async () => {
    const archive = join(workDir, 'pkg.tgz');
    await makeTarball(archive, ['package', 'evil.txt'], stage => {
      require('node:fs').mkdirSync(join(stage, 'package'));
      writeFileSync(join(stage, 'package/index.js'), 'x');
      writeFileSync(join(stage, 'evil.txt'), 'x');
    });
    await expect(extractNpmPackage(archive)).rejects.toThrow(/package\//);
  });

  it('rejects zip-bomb entries', async () => {
    const archive = join(workDir, 'pkg.tgz');
    await makeTarball(archive, ['package'], stage => {
      require('node:fs').mkdirSync(join(stage, 'package'));
      const bigPath = join(stage, 'package/big.bin');
      const fd = require('node:fs').openSync(bigPath, 'w');
      require('node:fs').ftruncateSync(fd, PAYLOAD_LIMIT + 1);
      require('node:fs').closeSync(fd);
    });
    await expect(extractNpmPackage(archive)).rejects.toThrow(/Zip bomb/);
  });
});
