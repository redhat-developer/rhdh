import type { LoggerService } from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';

import type { ProviderModuleInfo } from '@module-federation/sdk';

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { collectPluginPreload } from './collector';
import {
  DYNAMIC_FEATURES_MANIFEST_FILE,
  DYNAMIC_FEATURES_PLUGIN_ID,
} from './paths';
import { createPreloadStore } from './store';

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

function loadManifest(pluginDir: string): JsonObject {
  return JSON.parse(
    readFileSync(
      resolvePath(
        fixturesRoot,
        pluginDir,
        'dist',
        DYNAMIC_FEATURES_MANIFEST_FILE,
      ),
      'utf-8',
    ),
  );
}

describe('collectPluginPreload', () => {
  const baseUrl = 'http://localhost:7007';

  it('pushes a remotes entry and MF snapshot for a valid manifest', () => {
    const store = createPreloadStore();
    const logger = createMockLogger();
    const manifest = loadManifest('test-mixed-features-dynamic');

    collectPluginPreload(
      store,
      'plugin-test-mixed-features-dynamic',
      manifest,
      ['alpha'],
      baseUrl,
      logger,
    );

    expect(store.remotes).toHaveLength(1);
    expect(store.remotes[0]).toEqual({
      packageName: 'plugin-test-mixed-features-dynamic',
      remoteInfo: {
        name: 'backstage__plugin_test_mixed_features',
        entry: `${baseUrl}/${DYNAMIC_FEATURES_PLUGIN_ID}/remotes/plugin-test-mixed-features-dynamic/${DYNAMIC_FEATURES_MANIFEST_FILE}`,
      },
      exposedModules: ['alpha'],
    });

    // Collector stores generateSnapshotFromManifest output (ProviderModuleInfo);
    // GlobalModuleInfo values are a wider union.
    const pluginSnapshotEntry = store.moduleInfo
      .backstage__plugin_test_mixed_features as ProviderModuleInfo | undefined;
    expect(pluginSnapshotEntry).toBeDefined();
    if (!pluginSnapshotEntry) {
      throw new Error('expected MF snapshot');
    }
    expect(pluginSnapshotEntry.remoteEntry).toBe('remoteEntry.js');
    // ProviderModuleInfo is WithPublicPath | WithGetPublicPath
    expect(
      'publicPath' in pluginSnapshotEntry && pluginSnapshotEntry.publicPath,
    ).toBeTruthy();

    const modNames = (pluginSnapshotEntry.modules ?? []).map(
      (m: { moduleName: string }) => m.moduleName,
    );
    expect(modNames).toEqual(['alpha']);

    const alpha = (pluginSnapshotEntry.modules ?? []).find(
      (m: { moduleName: string }) => m.moduleName === 'alpha',
    );
    expect(alpha?.assets?.js?.sync).toEqual(
      expect.arrayContaining([
        'static/3000.aaa11111.chunk.js',
        'static/4000.bbb22222.chunk.js',
      ]),
    );
    expect(alpha?.assets?.css?.sync).toEqual(['static/alpha.ddd44444.css']);
  });

  it('trims snapshot modules to the filtered exposedModules list', () => {
    const store = createPreloadStore();
    const logger = createMockLogger();
    const manifest = loadManifest('test-mixed-features-dynamic');

    collectPluginPreload(
      store,
      'plugin-test-mixed-features-dynamic',
      manifest,
      ['alpha'],
      baseUrl,
      logger,
    );

    expect(store.remotes[0].exposedModules).toEqual(['alpha']);
    const snap = store.moduleInfo.backstage__plugin_test_mixed_features as
      ProviderModuleInfo | undefined;
    expect(snap).toBeDefined();
    if (!snap) {
      throw new Error('expected MF snapshot');
    }
    expect(
      (snap.modules ?? []).map((m: { moduleName: string }) => m.moduleName),
    ).toEqual(['alpha']);
  });

  it('skips collection and warns when manifest.name is missing', () => {
    const store = createPreloadStore();
    const logger = createMockLogger();

    collectPluginPreload(
      store,
      'broken-plugin',
      { exposes: [] } as JsonObject,
      ['.'],
      baseUrl,
      logger,
    );

    expect(store.remotes).toHaveLength(0);
    expect(store.moduleInfo).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing manifest.name'),
    );
  });
});
