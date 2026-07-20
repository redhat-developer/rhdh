import { Fragment, useContext } from 'react';
import * as useAsync from 'react-use/lib/useAsync';

import * as appDefaults from '@backstage/app-defaults';
import { Entity } from '@backstage/catalog-model';
import { AppRouteBinder, defaultConfigLoader } from '@backstage/core-app-api';
import {
  analyticsApiRef,
  createApiFactory,
  createApiRef,
  createExternalRouteRef,
  createPlugin,
  createRouteRef,
  useApp,
} from '@backstage/core-plugin-api';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';
import { removeScalprum } from '@scalprum/core';
import { render, waitFor, within } from '@testing-library/react';

import initializeRemotePlugins from '../../utils/dynamicUI/initializeRemotePlugins';
import DynamicRoot from './DynamicRoot';

const InnerPage = () => {
  const app = useApp();

  return <>{Object.keys(app.getSystemIcons()).join(',')}</>;
};

const MockPage = () => {
  const { AppProvider, dynamicRoutes, mountPoints } =
    useContext(DynamicRootContext);

  return (
    <AppProvider>
      <div data-testid="isLoadingFinished" />
      <div data-testid="dynamicRoutes">
        {dynamicRoutes
          .filter(r => Boolean(r.Component))
          .map(
            r => `${r.path}${r.staticJSXContent ? ' (with static JSX)' : ''}`,
          )
          .join(', ')}
      </div>
      <div data-testid="mountPoints">
        {Object.entries(mountPoints)
          .map(
            ([k, v]) =>
              `${k}: ${v.length}${
                v.filter(c => Boolean(c.staticJSXContent)).length
                  ? ' (with static JSX)'
                  : ''
              }`,
          )
          .join(', ')}
      </div>
      <div data-testid="mountPointsIfs">
        {Object.entries(mountPoints)
          .map(
            ([k, v]) =>
              `${k}: ${v.map(c => c.config?.if({} as Entity)).join('_')}`,
          )
          .join(', ')}
      </div>
      <div data-testid="appIcons">
        <InnerPage />
      </div>
    </AppProvider>
  );
};

const MockApp = ({
  dynamicPlugins,
}: {
  dynamicPlugins: any; // allow tests to supply specific values for specific use cases
}) => (
  <DynamicRoot
    apis={[]}
    afterInit={async () =>
      Promise.resolve({
        default: () => {
          return <MockPage />;
        },
      })
    }
    dynamicPlugins={dynamicPlugins}
    scalprumConfig={{}}
    baseUrl="http://localhost:7007"
  />
);

jest.mock('@scalprum/core', () => ({
  ...jest.requireActual('@scalprum/core'),
  getScalprum: jest.fn().mockReturnValue({ api: {} }),
}));

jest.mock('@scalprum/react-core', () => ({
  ...jest.requireActual('@scalprum/react-core'),
  ScalprumProvider: jest
    .fn()
    .mockImplementation(({ children }) => <>{children}</>),
  useScalprum: jest
    .fn()
    .mockReturnValue({ initialized: true, pluginStore: [] }),
}));

jest.mock('react-use/lib/useAsync', () => ({
  default: () => ({}),
  __esModule: true,
}));

jest.mock('@backstage/app-defaults', () => {
  const actual = jest.requireActual('@backstage/app-defaults');
  return {
    ...actual,
    __esModule: true,
    createApp: jest.fn((...args: unknown[]) =>
      actual.createApp(...(args as Parameters<typeof actual.createApp>)),
    ),
  };
});

// Avoid real network calls to backend.baseUrl (can hang on localhost in CI).
jest.mock('../../utils/translations/fetchOverrideTranslations', () => ({
  __esModule: true,
  fetchOverrideTranslations: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../utils/dynamicUI/initializeRemotePlugins', () => ({
  default: jest.fn(),
  __esModule: true,
}));
const mockInitializeRemotePlugins = jest.requireMock(
  '../../utils/dynamicUI/initializeRemotePlugins',
).default as jest.MockedFunction<typeof initializeRemotePlugins>;

const loadTestConfig = async (dynamicPlugins: any) => {
  process.env = {
    NODE_ENV: 'test',
    APP_CONFIG: [
      {
        data: {
          app: { title: 'Test' },
          backend: { baseUrl: 'http://localhost:7007' },
          techdocs: {
            storageUrl: 'http://localhost:7007/api/techdocs/static/docs',
          },
          auth: { environment: 'development' },
          dynamicPlugins,
        },
        context: 'test',
      },
    ] as any,
  };
  await defaultConfigLoader();
};

const consoleSpy = jest.spyOn(console, 'warn');

// DynamicRoot always injects framework APIs (e.g. the translation API) into
// createApp; this returns only the dynamic/custom APIs so assertions stay
// focused on what the plugin config contributed.
const FRAMEWORK_API_IDS = ['core.translation'];
const getDynamicApis = (createAppSpy: jest.Mock) =>
  [...(createAppSpy.mock.calls[0][0]?.apis ?? [])].filter(
    apiFactory => !FRAMEWORK_API_IDS.includes(apiFactory.api.id),
  );

describe('DynamicRoot', () => {
  beforeEach(() => {
    removeScalprum();
    (appDefaults.createApp as jest.Mock).mockClear();
    // Belt-and-suspenders: DynamicRoot (and deps) must not hit a real backend.
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response),
    );
    mockInitializeRemotePlugins.mockImplementation(
      (_, __, requiredModules: { scope: string; module: string }[]) =>
        Promise.resolve({
          'foo.bar': {
            ...(requiredModules.some(m => m.module === 'PluginRoot')
              ? {
                  PluginRoot: {
                    default: Fragment,
                    fooPlugin: createPlugin({
                      id: 'fooPlugin',
                      routes: { bar: createRouteRef({ id: 'bar' }) },
                    }),
                    fooPluginTarget: createPlugin({
                      id: 'fooPluginTarget',
                      externalRoutes: {
                        barTarget: createExternalRouteRef({
                          id: 'bar',
                          optional: true,
                        }),
                      },
                    }),
                    fooPluginApi: createApiFactory({
                      api: createApiRef<{}>({
                        id: 'plugin.foo.service',
                      }),
                      deps: {},
                      factory: () => ({}),
                    }),
                    fooPluginAnalyticsApi: {
                      fromConfig: () => ({ captureEvent: () => {} }),
                    },
                    FooComponent: Fragment,
                    isFooConditionTrue: () => true,
                    isFooConditionFalse: () => false,
                    FooComponentWithStaticJSX: {
                      element: ({ children }) => <>{children}</>,
                      staticJSXContent: <div />,
                    },
                  },
                }
              : {}),
            ...(requiredModules.some(m => m.module === 'OtherModule')
              ? {
                  OtherModule: {
                    barPlugin: createPlugin({
                      id: 'barPlugin',
                    }),
                  },
                }
              : {}),
          },
        }),
    );
    jest
      .spyOn(useAsync, 'default')
      .mockReturnValue({ loading: false, value: {} });
  });

  afterEach(() => {
    consoleSpy.mockReset();
    jest.mocked(global.fetch).mockRestore();
  });

  it('should add plugins found in default module', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {},
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();
      expect(
        createAppSpy.mock.calls[0][0]?.plugins?.map(
          (p: { getId: () => string }) => p.getId(),
        ),
      ).toEqual(['fooPlugin', 'fooPluginTarget']);
    });
  });

  it('should add plugins found in specified module', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          pluginModule: 'OtherModule',
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();
      expect(
        createAppSpy.mock.calls[0][0]?.plugins?.map(
          (p: { getId: () => string }) => p.getId(),
        ),
      ).toEqual(['barPlugin']);
    });
  });

  it('should render with one dynamicRoute', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': { dynamicRoutes: [{ path: '/foo' }] },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('dynamicRoutes')).getByText('/foo'),
      ).toBeInTheDocument();
    });
  });

  it('should render with two dynamicRoutes', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          dynamicRoutes: [{ path: '/foo' }, { path: '/bar' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('dynamicRoutes')).getByText('/foo, /bar'),
      ).toBeInTheDocument();
    });
  });

  it('should render with one dynamicRoute from nonexistent plugin', async () => {
    const dynamicPlugins = {
      frontend: {
        'doesnt.exist': {
          dynamicRoutes: [{ path: '/foo' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('dynamicRoutes')).getByText('/foo'),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin doesnt.exist is not configured properly: PluginRoot.default not found, ignoring dynamicRoute: "/foo"',
      );
    });
  });

  it('should render with one dynamicRoute with nonexistent importName', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          dynamicRoutes: [{ path: '/foo', importName: 'BarComponent' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('dynamicRoutes')).getByText('/foo'),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin foo.bar is not configured properly: PluginRoot.BarComponent not found, ignoring dynamicRoute: "/foo"',
      );
    });
  });

  it('should render with one dynamicRoute with nonexistent module', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          dynamicRoutes: [{ path: '/foo', module: 'BarPlugin' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('dynamicRoutes')).getByText('/foo'),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin foo.bar is not configured properly: BarPlugin.default not found, ignoring dynamicRoute: "/foo"',
      );
    });
  });

  it('should render with one dynamicRoute with staticJSXContent', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          dynamicRoutes: [
            {
              path: '/foo',
              importName: 'FooComponentWithStaticJSX',
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('dynamicRoutes')).getByText(
          '/foo (with static JSX)',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should render with one mountPoint with single component', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPoints')).getByText('a.b.c/cards: 1'),
      ).toBeInTheDocument();
    });
  });

  it('should render with one mountPoint with two components', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
            },
            {
              mountPoint: 'a.b.c/cards',
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPoints')).getByText('a.b.c/cards: 2'),
      ).toBeInTheDocument();
    });
  });

  it("should render with one mountPoint with two components where one importName doesn't exist", async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
            },
            {
              mountPoint: 'a.b.c/cards',
              importName: 'BarComponent',
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPoints')).getByText('a.b.c/cards: 1'),
      ).toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin foo.bar is not configured properly: PluginRoot.BarComponent not found, ignoring mountPoint: "a.b.c/cards"',
      );
    });
  });

  it('should render with one mountPoint with config.if === true', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
              config: { if: { allOf: ['isFooConditionTrue'] } },
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPointsIfs')).getByText(
          'a.b.c/cards: true',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should render with one mountPoint with config.if === false', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
              config: { if: { allOf: ['isFooConditionFalse'] } },
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPointsIfs')).getByText(
          'a.b.c/cards: false',
        ),
      ).toBeInTheDocument();
    });
  });

  it("should render with one mountPoint with config.if where importName doesn't exist", async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
              config: { if: { allOf: ['isBarConditionTrue'] } },
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPointsIfs')).getByText(
          'a.b.c/cards: false',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should render with two mountPoints with one component each', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            { mountPoint: 'a.b.c/cards' },
            { mountPoint: 'x.y.z/cards' },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPoints')).getByText(
          'a.b.c/cards: 1, x.y.z/cards: 1',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should render with one mountPoint from nonexistent plugin', async () => {
    const dynamicPlugins = {
      frontend: {
        'doesnt.exist': { mountPoints: [{ mountPoint: 'a.b.c/cards' }] },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('mountPoints')).getByText('a.b.c/cards: 1'),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin doesnt.exist is not configured properly: PluginRoot.default not found, ignoring mountPoint: "a.b.c/cards"',
      );
    });
  });

  it('should render with one mountPoint with nonexistent importName', async () => {
    const dynamicPlugins = {
      frontend: {
        'doesnt.exist': {
          mountPoints: [
            { mountPoint: 'a.b.c/cards', importName: 'BarComponent' },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('mountPoints')).getByText('a.b.c/cards: 1'),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin doesnt.exist is not configured properly: PluginRoot.BarComponent not found, ignoring mountPoint: "a.b.c/cards"',
      );
    });
  });

  it('should render with one mountPoint with nonexistent module', async () => {
    const dynamicPlugins = {
      frontend: {
        'doesnt.exist': {
          mountPoints: [{ mountPoint: 'a.b.c/cards', module: 'BarPlugin' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('mountPoints')).getByText('a.b.c/cards: 1'),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin doesnt.exist is not configured properly: BarPlugin.default not found, ignoring mountPoint: "a.b.c/cards"',
      );
    });
  });

  it('should render with one mountPoint with staticJSXContent', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          mountPoints: [
            {
              mountPoint: 'a.b.c/cards',
              importName: 'FooComponentWithStaticJSX',
            },
          ],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('mountPoints')).getByText(
          'a.b.c/cards: 1 (with static JSX)',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should render with one appIcon', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': { appIcons: [{ name: 'fooIcon' }] },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('appIcons')).getByText(/fooIcon/),
      ).toBeInTheDocument();
    });
  });

  it('should render with two appIcons', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': { appIcons: [{ name: 'fooIcon' }, { name: 'foo2Icon' }] },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('appIcons')).getByText(/fooIcon/),
      ).toBeInTheDocument();
      expect(
        within(rendered.getByTestId('appIcons')).getByText(/foo2Icon/),
      ).toBeInTheDocument();
    });
  });

  it('should render with one appIcon from nonexistent plugin', async () => {
    const dynamicPlugins = {
      frontend: {
        'doesnt.exist': { appIcons: [{ name: 'fooIcon' }] },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(() =>
        within(rendered.getByTestId('appIcons')).getByText(/fooIcon/),
      ).toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin doesnt.exist is not configured properly: PluginRoot.default not found, ignoring appIcon: fooIcon',
      );
    });
  });

  it('should bind routes on routeBindings target', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          routeBindings: {
            targets: [
              { importName: 'fooPluginTarget' },
              { importName: 'fooPlugin' },
            ],
            bindings: [
              {
                bindTarget: 'fooPluginTarget.externalRoutes',
                bindMap: { barTarget: 'fooPlugin.routes.bar' },
              },
            ],
          },
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();
      const bindResult: Record<string, any> = {};
      const bindFunc: AppRouteBinder = (externalRoutes, targetRoutes) => {
        bindResult.externalRoutes = externalRoutes;
        bindResult.targetRoutes = targetRoutes;
      };
      createAppSpy.mock.calls[0][0]?.bindRoutes?.({ bind: bindFunc });
      expect(bindResult).toEqual({
        externalRoutes: {
          barTarget: createExternalRouteRef({ id: 'bar', optional: true }),
        },
        targetRoutes: { barTarget: createRouteRef({ id: 'bar' }) },
      });
      expect(
        createAppSpy.mock.calls[0][0]?.plugins?.map(
          (p: { getId: () => string }) => p.getId(),
        ),
      ).toEqual(['fooPlugin', 'fooPluginTarget']);
    });
  });

  it('should bind routes on routeBindings target with a custom name', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          routeBindings: {
            targets: [
              {
                importName: 'fooPluginTarget',
                name: 'fooPluginTargetWithCustomName',
              },
              { importName: 'fooPlugin' },
            ],
            bindings: [
              {
                bindTarget: 'fooPluginTargetWithCustomName.externalRoutes',
                bindMap: { barTarget: 'fooPlugin.routes.bar' },
              },
            ],
          },
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();
      const bindResult: Record<string, any> = {};
      const bindFunc: AppRouteBinder = (externalRoutes, targetRoutes) => {
        bindResult.externalRoutes = externalRoutes;
        bindResult.targetRoutes = targetRoutes;
      };
      createAppSpy.mock.calls[0][0]?.bindRoutes?.({ bind: bindFunc });
      expect(bindResult).toEqual({
        externalRoutes: {
          barTarget: createExternalRouteRef({ id: 'bar', optional: true }),
        },
        targetRoutes: { barTarget: createRouteRef({ id: 'bar' }) },
      });
    });
  });

  it('should not bind routes on routeBindings target with nonexistent importName', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          routeBindings: {
            targets: [
              {
                importName: 'barPlugin',
              },
              { importName: 'fooPlugin' },
            ],
            bindings: [
              {
                bindTarget: 'barPlugin.externalRoutes',
                bindMap: { barTarget: 'fooPlugin.routes.bar' },
              },
            ],
          },
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin foo.bar is not configured properly: PluginRoot.barPlugin not found, ignoring routeBindings target: barPlugin',
      );
    });
  });

  it('should add custom ApiFactory', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          apiFactories: [{ importName: 'fooPluginApi' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();

      const resolvedApis = getDynamicApis(createAppSpy);
      expect(resolvedApis.length).toEqual(1);
      expect(resolvedApis[0].api.id).toEqual('plugin.foo.service');
    });
  });

  it('should not add custom ApiFactory with nonexistent importName', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          apiFactories: [{ importName: 'barPluginApi' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();

      const resolvedApis = getDynamicApis(createAppSpy);
      expect(resolvedApis.length).toEqual(0);
    });
  });

  it('should not add custom ApiFactory with nonexistent module', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          apiFactories: [{ importName: 'fooPluginApi', module: 'BarPlugin' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();

      const resolvedApis = getDynamicApis(createAppSpy);
      expect(resolvedApis.length).toEqual(0);
    });
  });

  it('should add custom AnalyticsApi extension', async () => {
    const createAppSpy = appDefaults.createApp as jest.Mock;
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          analyticsApiExtensions: [{ importName: 'fooPluginAnalyticsApi' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = render(<MockApp dynamicPlugins={dynamicPlugins} />);
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(createAppSpy).toHaveBeenCalled();

      const resolvedApis = getDynamicApis(createAppSpy);
      expect(resolvedApis.length).toEqual(1);
      // Analytics extensions are wrapped into a MultipleAnalyticsApi
      // registered under analyticsApiRef, not the plugin's own api id.
      expect(resolvedApis[0].api.id).toEqual(analyticsApiRef.id);
    });
  });
});
