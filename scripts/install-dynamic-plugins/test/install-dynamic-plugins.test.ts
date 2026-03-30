/**
 * Tests for @internal/install-dynamic-plugins (replaces former shell suite).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseNpmPluginKey } from '../src/npm-parse-plugin-key.js';
import { parseOciRef } from '../src/oci-ref.js';
import { runMain } from '../src/install.js';

const EXPECTED_SEMVER_CONFIG_HASH =
  '9a1c28348ec09ef4d6d989ee83ac5bbf08e5ba16709fcc55516ca040186377f8';

describe('parseNpmPluginKey', () => {
  test('strips version from scoped backstage package', () => {
    expect(parseNpmPluginKey('@backstage/plugin-catalog@1.0.0')).toBe(
      '@backstage/plugin-catalog'
    );
  });

  test('preserves local path', () => {
    expect(parseNpmPluginKey('./local')).toBe('./local');
  });
});

describe('parseOciRef', () => {
  test('parses oci://host/path:tag', () => {
    const r = parseOciRef('oci://quay.io/user/plugin:v1.0');
    expect(r.registry).toBe('quay.io');
    expect(r.repository).toBe('user/plugin');
  });
});

describe('runMain integration', () => {
  let prevCwd: string;
  const tmpDirs: string[] = [];

  beforeEach(() => {
    prevCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function workdir(): string {
    const w = mkdtempSync(join(tmpdir(), 'idp-test-'));
    tmpDirs.push(w);
    return w;
  }

  test('empty plugins list produces app-config.dynamic-plugins.yaml', async () => {
    const w = workdir();
    mkdirSync(join(w, 'out'), { recursive: true });
    writeFileSync(join(w, 'dynamic-plugins.yaml'), 'plugins: []\n');
    process.chdir(w);
    await runMain(join(w, 'out'));
    expect(existsSync(join(w, 'out', 'app-config.dynamic-plugins.yaml'))).toBe(
      true
    );
  });

  test('semver@7.0.0 install writes expected plugin hash and package.json', async () => {
    const w = workdir();
    mkdirSync(join(w, 'out'), { recursive: true });
    writeFileSync(
      join(w, 'dynamic-plugins.yaml'),
      `plugins:
  - package: semver@7.0.0
    integrity: sha512-+GB6zVA9LWh6zovYQLALHwv5rb2PHGlJi3lfiqIHxR0uuwCgefcOJc59v9fv1w8GbStwxuuqqAjI9NMAOOgq1A==
`
    );
    process.chdir(w);
    await runMain(join(w, 'out'));
    const h = readFileSync(
      join(w, 'out', 'semver-7.0.0', 'dynamic-plugin-config.hash'),
      'utf8'
    ).trim();
    expect(h).toBe(EXPECTED_SEMVER_CONFIG_HASH);
    expect(existsSync(join(w, 'out', 'semver-7.0.0', 'package.json'))).toBe(
      true
    );
  });
});
