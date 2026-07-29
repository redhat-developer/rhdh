import {
  CommonJSModuleLoader,
  dynamicPluginsFeatureLoader,
} from '@backstage/backend-dynamic-feature-service';
import { LoggerService } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

import { resolve as resolvePath } from 'node:path';

import { nfsModuleFilterPlugin } from './nfsModuleFilter';

jest.setTimeout(60_000);

async function testModuleLoader(logger: LoggerService) {
  const loader = new CommonJSModuleLoader({ logger });
  (loader as any).module = await loader.load('node:module');
  loader.bootstrap = async () => {};
  return loader;
}

const dynamicPluginsRootDirectory = resolvePath(
  __dirname,
  '__fixtures__/dynamic-plugins-root-for-nfs-filter',
);

const REMOTES_URL = '/.backstage/dynamic-features/remotes';

function findPlugin(remotes: any[], packageName: string) {
  return remotes.find((r: any) => r.packageName === packageName);
}

describe('nfsModuleFilterPlugin', () => {
  it('should keep only NFS modules and filter out unlisted ones when backstage.features is present', async () => {
    const { server } = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: {
            dynamicPlugins: {
              rootDirectory: dynamicPluginsRootDirectory,
            },
            backend: {
              baseUrl: 'http://localhost:0',
            },
          },
        }),
        dynamicPluginsFeatureLoader({
          moduleLoader: logger => testModuleLoader(logger),
        }),
        nfsModuleFilterPlugin,
      ],
    });

    const res = await fetch(`http://localhost:${server.port()}${REMOTES_URL}`);
    expect(res.ok).toBe(true);
    const remotes = await res.json();

    const mixedPlugin = findPlugin(
      remotes,
      'plugin-test-mixed-features-dynamic',
    );
    expect(mixedPlugin).toBeDefined();
    expect(mixedPlugin.exposedModules).toEqual(['alpha']);
  });

  it('should keep all modules when backstage.features is absent (backwards compat)', async () => {
    const { server } = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: {
            dynamicPlugins: {
              rootDirectory: dynamicPluginsRootDirectory,
            },
            backend: {
              baseUrl: 'http://localhost:0',
            },
          },
        }),
        dynamicPluginsFeatureLoader({
          moduleLoader: logger => testModuleLoader(logger),
        }),
        nfsModuleFilterPlugin,
      ],
    });

    const res = await fetch(`http://localhost:${server.port()}${REMOTES_URL}`);
    expect(res.ok).toBe(true);
    const remotes = await res.json();

    const noFeaturesPlugin = findPlugin(
      remotes,
      'plugin-test-no-features-dynamic',
    );
    expect(noFeaturesPlugin).toBeDefined();
    expect(noFeaturesPlugin.exposedModules).toEqual(['.', 'alpha']);
  });

  it('should keep all modules when all backstage.features are NFS types', async () => {
    const { server } = await startTestBackend({
      features: [
        mockServices.rootConfig.factory({
          data: {
            dynamicPlugins: {
              rootDirectory: dynamicPluginsRootDirectory,
            },
            backend: {
              baseUrl: 'http://localhost:0',
            },
          },
        }),
        dynamicPluginsFeatureLoader({
          moduleLoader: logger => testModuleLoader(logger),
        }),
        nfsModuleFilterPlugin,
      ],
    });

    const res = await fetch(`http://localhost:${server.port()}${REMOTES_URL}`);
    expect(res.ok).toBe(true);
    const remotes = await res.json();

    const allNfsPlugin = findPlugin(remotes, 'plugin-test-all-nfs-dynamic');
    expect(allNfsPlugin).toBeDefined();
    expect(allNfsPlugin.exposedModules).toEqual(['.', 'alpha']);
  });
});
