import type { LoggerService } from '@backstage/backend-plugin-api';

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { hashedRemoteEntryName } from './remoteEntryHash';
import {
  HASHED_REMOTE_ENTRY_PATH_RE,
  lookupRemoteEntry,
  registerRemoteEntry,
  remoteEntryRegistry,
} from './remoteEntryRegistry';

const fixturesRoot = resolvePath(
  __dirname,
  '../__fixtures__/dynamic-plugins-root-for-nfs-filter',
);

function createMockLogger(): LoggerService {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as LoggerService;
}

function fixtureEntryBytes(pluginDir: string): Buffer {
  return readFileSync(
    resolvePath(fixturesRoot, pluginDir, 'dist/remoteEntry.js'),
  );
}

beforeEach(() => {
  remoteEntryRegistry.clear();
});

describe('registerRemoteEntry', () => {
  it('reads the entry bytes and populates the hash and precomputed encodings', () => {
    const logger = createMockLogger();
    const bytes = fixtureEntryBytes('test-mixed-features-dynamic');

    registerRemoteEntry(
      'plugin-test-mixed-features-dynamic',
      resolvePath(fixturesRoot, 'test-mixed-features-dynamic'),
      logger,
    );

    const record = remoteEntryRegistry.get(
      'plugin-test-mixed-features-dynamic',
    );
    expect(record).toBeDefined();
    expect(record!.bytes.equals(bytes)).toBe(true);
    expect(record!.hashedName).toBe(hashedRemoteEntryName(bytes));
    expect(brotliDecompressSync(record!.brotli).equals(bytes)).toBe(true);
    expect(gunzipSync(record!.gzip).equals(bytes)).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('handles scoped plugin names', () => {
    const bytes = fixtureEntryBytes('test-all-nfs-dynamic');

    registerRemoteEntry(
      '@scope/test-all-nfs-dynamic',
      resolvePath(fixturesRoot, 'test-all-nfs-dynamic'),
      createMockLogger(),
    );

    const record = remoteEntryRegistry.get('@scope/test-all-nfs-dynamic');
    expect(record).toBeDefined();
    expect(record!.bytes.equals(bytes)).toBe(true);
  });

  it('keeps the first registration and warns on a duplicate plugin name', () => {
    const logger = createMockLogger();
    const firstBytes = fixtureEntryBytes('test-mixed-features-dynamic');
    const secondBytes = fixtureEntryBytes('test-no-features-dynamic');
    expect(firstBytes.equals(secondBytes)).toBe(false);

    registerRemoteEntry(
      'duplicate-plugin',
      resolvePath(fixturesRoot, 'test-mixed-features-dynamic'),
      logger,
    );
    registerRemoteEntry(
      'duplicate-plugin',
      resolvePath(fixturesRoot, 'test-no-features-dynamic'),
      logger,
    );

    const record = remoteEntryRegistry.get('duplicate-plugin');
    expect(record!.bytes.equals(firstBytes)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already registered'),
    );
  });

  it('skips the plugin with a warning when the entry file is unreadable', () => {
    const logger = createMockLogger();

    registerRemoteEntry(
      'plugin-without-entry',
      resolvePath(fixturesRoot, 'does-not-exist'),
      logger,
    );

    expect(remoteEntryRegistry.has('plugin-without-entry')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not read remote entry'),
    );
  });
});

describe('HASHED_REMOTE_ENTRY_PATH_RE', () => {
  it('matches hashed entry URLs and extracts plugin name and hash', () => {
    const match = HASHED_REMOTE_ENTRY_PATH_RE.exec(
      '/.backstage/dynamic-features/remotes/plugin-example-dynamic/remoteEntry.0123456789abcdef.js',
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe('plugin-example-dynamic');
    expect(match![2]).toBe('0123456789abcdef');
  });

  it('matches scoped plugin names', () => {
    const match = HASHED_REMOTE_ENTRY_PATH_RE.exec(
      '/.backstage/dynamic-features/remotes/@red-hat-developer-hub/backstage-plugin-example-dynamic/remoteEntry.fedcba9876543210.js',
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe(
      '@red-hat-developer-hub/backstage-plugin-example-dynamic',
    );
    expect(match![2]).toBe('fedcba9876543210');
  });

  it.each([
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/remoteEntry.js',
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/mf-manifest.json',
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/remoteEntry.0123456789abcde.js',
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/remoteEntry.0123456789ABCDEF.js',
    '/static/remoteEntry.0123456789abcdef.js',
  ])('does not match %s', path => {
    expect(HASHED_REMOTE_ENTRY_PATH_RE.test(path)).toBe(false);
  });
});

describe('lookupRemoteEntry', () => {
  it('returns the record for the registered plugin and matching hash', () => {
    const bytes = fixtureEntryBytes('test-mixed-features-dynamic');
    registerRemoteEntry(
      'plugin-test-mixed-features-dynamic',
      resolvePath(fixturesRoot, 'test-mixed-features-dynamic'),
      createMockLogger(),
    );
    const hash = hashedRemoteEntryName(bytes).slice(
      'remoteEntry.'.length,
      -'.js'.length,
    );

    const record = lookupRemoteEntry(
      'plugin-test-mixed-features-dynamic',
      hash,
    );
    expect(record).toBeDefined();
    expect(record!.bytes.equals(bytes)).toBe(true);
  });

  it('returns undefined for a wrong (stale) hash', () => {
    const bytes = fixtureEntryBytes('test-mixed-features-dynamic');
    registerRemoteEntry(
      'plugin-test-mixed-features-dynamic',
      resolvePath(fixturesRoot, 'test-mixed-features-dynamic'),
      createMockLogger(),
    );
    expect(bytes.length).toBeGreaterThan(0);

    expect(
      lookupRemoteEntry(
        'plugin-test-mixed-features-dynamic',
        '0000000000000000',
      ),
    ).toBeUndefined();
  });

  it('returns undefined for an unknown plugin', () => {
    expect(
      lookupRemoteEntry('unknown-plugin', '0123456789abcdef'),
    ).toBeUndefined();
  });
});
