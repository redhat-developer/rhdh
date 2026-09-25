import { LoggerService } from '@backstage/backend-plugin-api';
import { JsonObject } from '@backstage/types';

import { resolve as resolvePath } from 'node:path';

import {
  filterNfsExposedModules,
  readBackstageFeatures,
} from './nfsModuleFilter';

const fixturesRoot = resolvePath(
  __dirname,
  './__fixtures__/dynamic-plugins-root-for-nfs-filter',
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

const emptyManifest: JsonObject = {};

describe('readBackstageFeatures', () => {
  it('returns features map when backstage.features exists', () => {
    const logger = createMockLogger();
    const features = readBackstageFeatures(
      'plugin-test-mixed-features-dynamic',
      resolvePath(fixturesRoot, 'test-mixed-features-dynamic'),
      logger,
    );
    expect(features).toEqual({ './alpha': '@backstage/FrontendPlugin' });
  });

  it('returns undefined when backstage.features is absent', () => {
    const logger = createMockLogger();
    const features = readBackstageFeatures(
      'plugin-test-no-features-dynamic',
      resolvePath(fixturesRoot, 'test-no-features-dynamic'),
      logger,
    );
    expect(features).toBeUndefined();
  });

  it('returns features map when all features are NFS types', () => {
    const logger = createMockLogger();
    const features = readBackstageFeatures(
      'plugin-test-all-nfs-dynamic',
      resolvePath(fixturesRoot, 'test-all-nfs-dynamic'),
      logger,
    );
    expect(features).toEqual({
      '.': '@backstage/FrontendPlugin',
      './alpha': '@backstage/FrontendModule',
    });
  });

  it('returns undefined and logs warning when package.json does not exist', () => {
    const logger = createMockLogger();
    const features = readBackstageFeatures(
      'nonexistent-plugin',
      resolvePath(fixturesRoot, 'nonexistent'),
      logger,
    );
    expect(features).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to read package.json'),
    );
  });
});

describe('filterNfsExposedModules', () => {
  it('keeps only NFS modules when features are present', () => {
    const logger = createMockLogger();
    const features = { './alpha': '@backstage/FrontendPlugin' };
    const result = filterNfsExposedModules(
      'test-plugin',
      ['.', 'alpha'],
      emptyManifest,
      features,
      logger,
    );
    expect(result).toEqual(['alpha']);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('filtered out [.]'),
    );
  });

  it('keeps all modules when features is undefined (backwards compat)', () => {
    const logger = createMockLogger();
    const result = filterNfsExposedModules(
      'test-plugin',
      ['.', 'alpha'],
      emptyManifest,
      undefined,
      logger,
    );
    expect(result).toEqual(['.', 'alpha']);
  });

  it('keeps all modules when all are NFS types', () => {
    const logger = createMockLogger();
    const features = {
      '.': '@backstage/FrontendPlugin',
      './alpha': '@backstage/FrontendModule',
    };
    const result = filterNfsExposedModules(
      'test-plugin',
      ['.', 'alpha'],
      emptyManifest,
      features,
      logger,
    );
    expect(result).toEqual(['.', 'alpha']);
  });

  it('handles modules already prefixed with ./', () => {
    const logger = createMockLogger();
    const features = { './alpha': '@backstage/FrontendPlugin' };
    const result = filterNfsExposedModules(
      'test-plugin',
      ['./alpha', './beta'],
      emptyManifest,
      features,
      logger,
    );
    expect(result).toEqual(['./alpha']);
  });
});
