import {
  CommonJSModuleLoader,
  dynamicPluginsFeatureLoader,
} from '@backstage/backend-dynamic-feature-service';
import { LoggerService } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

import { resolve as resolvePath } from 'node:path';

import { dynamicFeaturesResolver } from '../dynamicFeaturesResolver';
import {
  DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH,
  DYNAMIC_FEATURES_REMOTES_PATH,
} from './paths';

jest.setTimeout(60_000);

/**
 * Thin wiring smoke: proves the plugin is registered with the upstream
 * dynamic-features service, NFS filtering is applied on /remotes, and the
 * collected store is served from preload.js.
 *
 * Filter logic, collector, and handler are covered by unit tests — do not
 * re-assert those details here.
 */

async function testModuleLoader(logger: LoggerService) {
  const loader = new CommonJSModuleLoader({ logger });
  (loader as any).module = await loader.load('node:module');
  loader.bootstrap = async () => {};
  return loader;
}

const dynamicPluginsRootDirectory = resolvePath(
  __dirname,
  '../__fixtures__/dynamic-plugins-root-for-nfs-filter',
);

describe('dynamicFeaturesResolver wiring', () => {
  let port: number;

  beforeAll(async () => {
    const backend = await startTestBackend({
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
        dynamicFeaturesResolver,
      ],
    });
    port = backend.server.port();
  });

  it('wires NFS filtering into GET /remotes', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}`,
    );
    expect(res.ok).toBe(true);
    const remotes = await res.json();

    const mixed = remotes.find(
      (r: { packageName: string }) =>
        r.packageName === 'plugin-test-mixed-features-dynamic',
    );
    expect(mixed?.exposedModules).toEqual(['alpha']);

    const noFeatures = remotes.find(
      (r: { packageName: string }) =>
        r.packageName === 'plugin-test-no-features-dynamic',
    );
    expect(noFeatures?.exposedModules).toEqual(['.', 'alpha']);
  });

  it('serves preload.js whose remotes match /remotes filtering', async () => {
    const [remotesRes, preloadRes] = await Promise.all([
      fetch(`http://127.0.0.1:${port}${DYNAMIC_FEATURES_REMOTES_PATH}`),
      fetch(`http://127.0.0.1:${port}${DYNAMIC_FEATURES_PRELOAD_SCRIPT_PATH}`),
    ]);

    expect(preloadRes.ok).toBe(true);
    expect(preloadRes.headers.get('content-type')).toContain(
      'application/javascript',
    );

    const remotes = await remotesRes.json();
    const body = await preloadRes.text();

    expect(body).toContain('window.__FEDERATION__.moduleInfo');

    // Parse the local `var remotes = [...]` inside the IIFE
    const remotesMatch = body.match(/var remotes = (\[.+?\]);/s);
    expect(remotesMatch).not.toBeNull();
    const preloaded = JSON.parse(remotesMatch![1]);

    expect(preloaded).toHaveLength(remotes.length);
    for (const remote of remotes) {
      const match = preloaded.find(
        (r: { packageName: string }) => r.packageName === remote.packageName,
      );
      expect(match?.exposedModules).toEqual(remote.exposedModules);
      expect(match?.remoteInfo.name).toEqual(remote.remoteInfo.name);
    }
  });
});
