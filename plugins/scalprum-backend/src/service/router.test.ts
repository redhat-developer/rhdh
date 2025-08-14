import {
  DynamicPluginManager,
  ScannedPluginManifest,
  ScannedPluginPackage,
} from '@backstage/backend-dynamic-feature-service';
import { LoggerService } from '@backstage/backend-plugin-api';
import {
  createMockDirectory,
  mockServices,
} from '@backstage/backend-test-utils';

import express, { Router } from 'express';
import request from 'supertest';

import path from 'path';
import url from 'url';

import { createRouter } from './router';

describe('createRouter', () => {
  let app: express.Express;
  let router: Router;
  const mockDir = createMockDirectory();

  beforeEach(() => {
    app = express();
    mockDir.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
    app.delete('scalprum');
  });

  type TestCase = {
    name: string;
    packageManifest: ScannedPluginManifest & { scalprum?: { name: string } };
    pluginExternalBaseURL: string;
    distScalprumDir?: any;
    testedPluginsURL: string;
    expectedPluginsStatusCode: number;
    expectedPluginsBody: any;
    testedManifestURL?: string;
    expectedManifestStatusCode?: number;
    expectedManifestBody?: any;
    expectedWarning?: string;
  };

  it.each<TestCase>([
    {
      name: 'should add the frontend plugin in the scalprum plugin map',
      packageManifest: {
        name: 'frontend-dynamic-plugin-test',
        version: '0.0.0',
        backstage: {
          role: 'frontend-plugin',
        },
        main: 'dist/index.cjs.js',
        scalprum: {
          name: 'scalprum-plugin',
        },
      },
      pluginExternalBaseURL: 'http://localhost:3000',
      distScalprumDir: {
        'plugin-manifest.json': JSON.stringify({
          name: 'scalprum-plugin',
          anotherField: 'anotherValue',
        }),
      },
      testedPluginsURL: '/scalprum/plugins',
      expectedPluginsStatusCode: 200,
      expectedPluginsBody: {
        'scalprum-plugin': {
          manifestLocation:
            'http://localhost:3000/scalprum-plugin/plugin-manifest.json',
          name: 'scalprum-plugin',
        },
      },
      testedManifestURL: '/scalprum/scalprum-plugin/plugin-manifest.json',
      expectedManifestStatusCode: 200,
      expectedManifestBody: {
        name: 'scalprum-plugin',
        anotherField: 'anotherValue',
      },
    },
    {
      name: 'should skip a frontend plugin when the dist-scalprum sub-folder is missing',
      packageManifest: {
        name: 'frontend-dynamic-plugin-test',
        version: '0.0.0',
        backstage: {
          role: 'frontend-plugin',
        },
        main: 'dist/index.cjs.js',
        scalprum: {
          name: 'scalprum-plugin',
        },
      },
      pluginExternalBaseURL: 'http://localhost:3000',
      testedPluginsURL: '/scalprum/plugins',
      expectedPluginsStatusCode: 200,
      expectedPluginsBody: {},
      expectedWarning:
        "Could not find 'scalprum-dist' folder for plugin frontend-dynamic-plugin-test@0.0.0",
    },
    {
      name: 'should skip a frontend plugin when the dist-scalprum/plugin-manifest.json file is missing',
      packageManifest: {
        name: 'frontend-dynamic-plugin-test',
        version: '0.0.0',
        backstage: {
          role: 'frontend-plugin',
        },
        main: 'dist/index.cjs.js',
        scalprum: {
          name: 'scalprum-plugin',
        },
      },
      pluginExternalBaseURL: 'http://localhost:3000',
      distScalprumDir: {},
      testedPluginsURL: '/scalprum/plugins',
      expectedPluginsStatusCode: 200,
      expectedPluginsBody: {},
      expectedWarning:
        "Could not find 'dist-scalprum/plugin-manifest.json' for plugin frontend-dynamic-plugin-test@0.0.0",
    },
  ])('$name', async (tc: TestCase): Promise<void> => {
    const plugin: ScannedPluginPackage = {
      location: url.pathToFileURL(path.join(mockDir.path)),
      manifest: tc.packageManifest,
    };

    const mockedFiles: { [key: string]: any } = {};

    if (tc.distScalprumDir) {
      mockedFiles[
        path.join(url.fileURLToPath(plugin.location), 'dist-scalprum')
      ] = tc.distScalprumDir;
    }

    mockDir.setContent(mockedFiles);

    const warn = jest.fn();
    const logger: LoggerService = {
      error: jest.fn(),
      warn: warn,
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    };
    const config = mockServices.rootConfig();

    const pluginManager = new (DynamicPluginManager as any)(logger, [plugin], {
      logger,
      async bootstrap(_: string, __: string[]): Promise<void> {},
      load: async (packagePath: string) =>
        await import(/* webpackIgnore: true */ packagePath),
    });
    pluginManager._plugins.push(...(await pluginManager.loadPlugins()));

    const getBaseUrl = jest.fn().mockReturnValue('should-not-be-used');
    const getExternalBaseUrl = jest
      .fn()
      .mockReturnValue(tc.pluginExternalBaseURL);

    router = await createRouter({
      logger: logger,
      discovery: {
        getBaseUrl,
        getExternalBaseUrl,
      },
      pluginManager,
      config,
    });

    app.use('/scalprum', router);
    const response = await request(app).get(tc.testedPluginsURL);
    expect(response.status).toEqual(tc.expectedPluginsStatusCode);
    expect(response.body).toEqual(tc.expectedPluginsBody);

    let manifestStatusCode: number | undefined;
    let manifestBody: any | undefined;
    if (tc.testedManifestURL) {
      const manifestResponse = await request(app).get(tc.testedManifestURL);
      manifestStatusCode = manifestResponse.status;
      manifestBody = manifestResponse.body;
    }
    expect(manifestStatusCode).toEqual(tc.expectedManifestStatusCode);
    expect(manifestBody).toEqual(tc.expectedManifestBody);

    if (tc.expectedWarning) {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(warn).toHaveBeenCalledWith(tc.expectedWarning);
    }
  });
});
