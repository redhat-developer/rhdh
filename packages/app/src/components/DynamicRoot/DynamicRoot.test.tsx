import { Fragment, lazy, Suspense, useContext } from 'react';
import * as useAsync from 'react-use/lib/useAsync';

import * as appDefaults from '@backstage/app-defaults';
import { Entity } from '@backstage/catalog-model';
import { AppRouteBinder, defaultConfigLoader } from '@backstage/core-app-api';
import {
  createApiFactory,
  createApiRef,
  createExternalRouteRef,
  createPlugin,
  createRouteRef,
  useApp,
} from '@backstage/core-plugin-api';
import { renderWithEffects } from '@backstage/test-utils';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';
import { removeScalprum } from '@scalprum/core';
import { waitFor, within } from '@testing-library/dom';

import initializeRemotePlugins from '../../utils/dynamicUI/initializeRemotePlugins';

const DynamicRoot = lazy(() => import('./DynamicRoot'));

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
  <Suspense fallback={null}>
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
  </Suspense>
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

jest.mock('@backstage/app-defaults', () => ({
  ...jest.requireActual('@backstage/app-defaults'),
  __esModule: true,
}));

const mockInitializeRemotePlugins = jest.fn() as jest.MockedFunction<
  typeof initializeRemotePlugins
>;
jest.mock('../../utils/dynamicUI/initializeRemotePlugins', () => ({
  default: mockInitializeRemotePlugins,
  __esModule: true,
}));

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

// TODO: https://issues.redhat.com/browse/RHIDP-3611
// eslint-disable-next-line jest/no-disabled-tests
describe.skip('DynamicRoot', () => {
  beforeEach(() => {
    removeScalprum();
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
                        barTarget: createExternalRouteRef({ id: 'bar' }),
                      },
                    }),
                    fooPluginApi: createApiFactory({
                      api: createApiRef<{}>({
                        id: 'plugin.foo.service',
                      }),
                      deps: {},
                      factory: () => ({}),
                    }),
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
  });

  it('should add plugins found in default module', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {},
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
      await waitFor(async () => {
        expect(rendered.baseElement).toBeInTheDocument();
        expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
        expect(createAppSpy).toHaveBeenCalled();
        expect(
          createAppSpy.mock.calls[0][0]?.plugins?.map(p => p.getId()),
        ).toEqual(['fooPlugin', 'fooPluginTarget']);
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });

  it('should add plugins found in specified module', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          pluginModule: 'OtherModule',
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
      await waitFor(async () => {
        expect(rendered.baseElement).toBeInTheDocument();
        expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
        expect(createAppSpy).toHaveBeenCalled();
        expect(
          createAppSpy.mock.calls[0][0]?.plugins?.map(p => p.getId()),
        ).toEqual(['barPlugin']);
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });

  it('should render with one dynamicRoute', async () => {
    const dynamicPlugins = {
      frontend: {
        'foo.bar': { dynamicRoutes: [{ path: '/foo' }] },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
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
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
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
          externalRoutes: { barTarget: createExternalRouteRef({ id: 'bar' }) },
          targetRoutes: { barTarget: createRouteRef({ id: 'bar' }) },
        });
        expect(
          createAppSpy.mock.calls[0][0]?.plugins?.map(p => p.getId()),
        ).toEqual(['fooPlugin', 'fooPluginTarget']);
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });

  it('should bind routes on routeBindings target with a custom name', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
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
          externalRoutes: { barTarget: createExternalRouteRef({ id: 'bar' }) },
          targetRoutes: { barTarget: createRouteRef({ id: 'bar' }) },
        });
      });
    } finally {
      createAppSpy.mockRestore();
    }
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
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    await waitFor(async () => {
      expect(rendered.baseElement).toBeInTheDocument();
      expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Plugin foo.bar is not configured properly: PluginRoot.barPlugin not found, ignoring routeBindings target: barPlugin',
      );
    });
  });

  it('should add custom ApiFactory', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          apiFactories: [{ importName: 'fooPluginApi' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
      await waitFor(async () => {
        expect(rendered.baseElement).toBeInTheDocument();
        expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
        expect(createAppSpy).toHaveBeenCalled();

        const resolvedApis = [...(createAppSpy.mock.calls[0][0]?.apis ?? [])];
        expect(resolvedApis.length).toEqual(1);
        expect(resolvedApis[0].api.id).toEqual('plugin.foo.service');
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });

  it('should not add custom ApiFactory with nonexistent importName', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          apiFactories: [{ importName: 'barPluginApi' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
      await waitFor(async () => {
        expect(rendered.baseElement).toBeInTheDocument();
        expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
        expect(createAppSpy).toHaveBeenCalled();

        const resolvedApis = [...(createAppSpy.mock.calls[0][0]?.apis ?? [])];
        expect(resolvedApis.length).toEqual(0);
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });

  it('should not add custom ApiFactory with nonexistent module', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          apiFactories: [{ importName: 'fooPluginApi', module: 'BarPlugin' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
      await waitFor(async () => {
        expect(rendered.baseElement).toBeInTheDocument();
        expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
        expect(createAppSpy).toHaveBeenCalled();

        const resolvedApis = [...(createAppSpy.mock.calls[0][0]?.apis ?? [])];
        expect(resolvedApis.length).toEqual(0);
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });

  it('should add custom AnalyticsApi extension', async () => {
    const createAppSpy = jest.spyOn(appDefaults, 'createApp');
    const dynamicPlugins = {
      frontend: {
        'foo.bar': {
          analyticsApiExtensions: [{ importName: 'fooPluginAnalyticsApi' }],
        },
      },
    };
    await loadTestConfig(dynamicPlugins);
    const rendered = await renderWithEffects(
      <MockApp dynamicPlugins={dynamicPlugins} />,
    );
    try {
      await waitFor(async () => {
        expect(rendered.baseElement).toBeInTheDocument();
        expect(rendered.getByTestId('isLoadingFinished')).toBeInTheDocument();
        expect(createAppSpy).toHaveBeenCalled();

        const resolvedApis = [...(createAppSpy.mock.calls[0][0]?.apis ?? [])];
        expect(resolvedApis.length).toEqual(1);
        expect(resolvedApis[0].api.id).toEqual('plugin.foo.service');
      });
    } finally {
      createAppSpy.mockRestore();
    }
  });
});
