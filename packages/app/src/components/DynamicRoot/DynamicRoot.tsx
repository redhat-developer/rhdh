/* eslint-disable @typescript-eslint/no-shadow */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { createApp } from '@backstage/app-defaults';
import { BackstageApp } from '@backstage/core-app-api';
import { AnyApiFactory, BackstagePlugin } from '@backstage/core-plugin-api';

import { useThemes } from '@red-hat-developer-hub/backstage-plugin-theme';
import { AppsConfig } from '@scalprum/core';
import { useScalprum } from '@scalprum/react-core';

import bindAppRoutes from '../../utils/dynamicUI/bindAppRoutes';
import extractDynamicConfig, {
  configIfToCallable,
  DynamicPluginConfig,
  DynamicRoute,
} from '../../utils/dynamicUI/extractDynamicConfig';
import initializeRemotePlugins from '../../utils/dynamicUI/initializeRemotePlugins';
import { MenuIcon } from '../Root/MenuIcon';
import CommonIcons from './CommonIcons';
import defaultAppComponents from './defaultAppComponents';
import DynamicRootContext, {
  AppThemeProvider,
  ComponentRegistry,
  EntityTabOverrides,
  MountPoints,
  RemotePlugins,
  ResolvedDynamicRoute,
  ResolvedDynamicRouteMenuItem,
  ScaffolderFieldExtension,
  ScalprumMountPointConfig,
} from './DynamicRootContext';
import Loader from './Loader';

export type StaticPlugins = Record<
  string,
  {
    plugin: BackstagePlugin;
    module:
      | React.ComponentType<any>
      | { [importName: string]: React.ComponentType<any> };
  }
>;

export const DynamicRoot = ({
  afterInit,
  apis: staticApis,
  dynamicPlugins,
  staticPluginStore = {},
  scalprumConfig,
}: {
  afterInit: () => Promise<{ default: React.ComponentType }>;
  // Static APIs
  apis: AnyApiFactory[];
  dynamicPlugins: DynamicPluginConfig;
  staticPluginStore?: StaticPlugins;
  scalprumConfig: AppsConfig;
}) => {
  const app = useRef<BackstageApp>();
  const [ChildComponent, setChildComponent] = useState<
    React.ComponentType | undefined
  >(undefined);
  // registry of remote components loaded at bootstrap
  const [components, setComponents] = useState<ComponentRegistry | undefined>();
  const { initialized, pluginStore, api: scalprumApi } = useScalprum();

  const themes = useThemes();

  // Fills registry of remote components
  const initializeRemoteModules = useCallback(async () => {
    const {
      pluginModules,
      apiFactories,
      appIcons,
      dynamicRoutes,
      menuItems,
      entityTabs,
      mountPoints,
      routeBindings,
      routeBindingTargets,
      scaffolderFieldExtensions,
      themes: pluginThemes,
    } = extractDynamicConfig(dynamicPlugins);
    const requiredModules = [
      ...pluginModules.map(({ scope, module }) => ({
        scope,
        module,
      })),
      ...routeBindingTargets.map(({ scope, module }) => ({
        scope,
        module,
      })),
      ...mountPoints.map(({ module, scope }) => ({
        scope,
        module,
      })),
      ...dynamicRoutes.map(({ scope, module }) => ({
        scope,
        module,
      })),
      ...appIcons.map(({ scope, module }) => ({
        scope,
        module,
      })),
      ...apiFactories.map(({ scope, module }) => ({
        scope,
        module,
      })),
      ...scaffolderFieldExtensions.map(({ scope, module }) => ({
        scope,
        module,
      })),
      ...pluginThemes.map(({ scope, module }) => ({
        scope,
        module,
      })),
    ];

    const staticPlugins = Object.keys(staticPluginStore).reduce(
      (acc, pluginKey) => {
        return {
          ...acc,
          [pluginKey]: { PluginRoot: staticPluginStore[pluginKey].module },
        };
      },
      {},
    ) as RemotePlugins;
    const remotePlugins = await initializeRemotePlugins(
      pluginStore,
      scalprumConfig,
      requiredModules,
    );

    const allScopes = Object.values(remotePlugins);
    const allModules = allScopes.flatMap(scope => Object.values(scope));
    const allImports = allModules.flatMap(module => Object.values(module));
    const remoteBackstagePlugins = allImports.filter(imported => {
      if (!imported) {
        return false;
      }
      const prototype = Object.getPrototypeOf(imported);
      return (
        prototype !== undefined &&
        [
          'getId',
          'getApis',
          'getFeatureFlags',
          'provide',
          'routes',
          'externalRoutes',
        ].every(field => field in prototype)
      );
    }) as BackstagePlugin<{}>[];

    const allPlugins = { ...staticPlugins, ...remotePlugins };
    const resolvedRouteBindingTargets = Object.fromEntries(
      routeBindingTargets.reduce<[string, BackstagePlugin<{}>][]>(
        (acc, { name, importName, scope, module }) => {
          const plugin = allPlugins[scope]?.[module]?.[importName];

          if (plugin) {
            acc.push([name, plugin as BackstagePlugin<{}>]);
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring routeBindings target: ${name}`,
            );
          }
          return acc;
        },
        [],
      ),
    );

    let icons = Object.fromEntries(
      appIcons.reduce<[string, React.ComponentType<{}>][]>(
        (acc, { scope, module, importName, name }) => {
          const Component = allPlugins[scope]?.[module]?.[importName];

          if (Component) {
            acc.push([name, Component as React.ComponentType<{}>]);
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring appIcon: ${name}`,
            );
          }
          return acc;
        },
        [],
      ),
    );

    icons = { ...CommonIcons, ...icons };

    const remoteApis = apiFactories.reduce<AnyApiFactory[]>(
      (acc, { scope, module, importName }) => {
        const apiFactory = allPlugins[scope]?.[module]?.[importName];

        if (apiFactory) {
          acc.push(apiFactory as AnyApiFactory);
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring apiFactory: ${importName}`,
          );
        }
        return acc;
      },
      [],
    );

    const providerMountPoints = mountPoints.reduce<
      {
        mountPoint: string;
        Component: React.ComponentType<{}>;
        config?: ScalprumMountPointConfig;
        staticJSXContent?: React.ReactNode;
      }[]
    >((acc, { module, importName, mountPoint, scope, config }) => {
      const Component = allPlugins[scope]?.[module]?.[importName];
      // Only add mount points that have a component
      if (Component) {
        const ifCondition = configIfToCallable(
          Object.fromEntries(
            Object.entries(config?.if || {}).map(([k, v]) => [
              k,
              v.map(c => {
                if (typeof c === 'string') {
                  const remoteFunc = allPlugins[scope]?.[module]?.[c];
                  if (remoteFunc === undefined) {
                    // eslint-disable-next-line no-console
                    console.warn(
                      `Plugin ${scope} is not configured properly: ${module}.${c} not found, ignoring .config.if for mountPoint: "${mountPoint}"`,
                    );
                  }
                  return remoteFunc || {};
                }
                return c || {};
              }),
            ]),
          ),
        );

        acc.push({
          mountPoint,
          Component:
            typeof Component === 'object' && 'element' in Component
              ? (Component.element as React.ComponentType<{}>)
              : (Component as React.ComponentType<{}>),
          staticJSXContent:
            typeof Component === 'object' && 'staticJSXContent' in Component
              ? (Component.staticJSXContent as React.ReactNode)
              : null,
          config: {
            ...config,
            if: ifCondition,
          },
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring mountPoint: "${mountPoint}"`,
        );
      }
      return acc;
    }, []);

    const mountPointComponents = providerMountPoints.reduce<MountPoints>(
      (acc, entry) => {
        if (!acc[entry.mountPoint]) {
          acc[entry.mountPoint] = [];
        }
        acc[entry.mountPoint].push({
          Component: entry.Component,
          staticJSXContent: entry.staticJSXContent,
          config: entry.config,
        });
        return acc;
      },
      {},
    );

    const dynamicRoutesComponents = dynamicRoutes.reduce<
      ResolvedDynamicRoute[]
    >((acc, route) => {
      function resolveMenuItem(
        route: DynamicRoute,
      ): ResolvedDynamicRouteMenuItem | undefined {
        if (route.menuItem === undefined) {
          return undefined;
        }
        if ('text' in route.menuItem) {
          return route.menuItem;
        }
        const MenuItemComponent =
          allPlugins[route.scope]?.[route.menuItem.module ?? route.module]?.[
            route.menuItem.importName
          ];
        if (MenuItemComponent === undefined) {
          return undefined;
        }
        return {
          Component: MenuItemComponent as React.ComponentType<{}>,
          config: route.menuItem.config || {},
        };
      }
      const Component =
        allPlugins[route.scope]?.[route.module]?.[route.importName];
      if (Component) {
        acc.push({
          ...route,
          menuItem: resolveMenuItem(route),
          Component:
            typeof Component === 'object' && 'element' in Component
              ? (Component.element as React.ComponentType<{}>)
              : (Component as React.ComponentType<{}>),
          staticJSXContent:
            typeof Component === 'object' && 'staticJSXContent' in Component
              ? (Component.staticJSXContent as React.ReactNode)
              : null,
          config: route.config ?? {},
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `Plugin ${route.scope} is not configured properly: ${route.module}.${route.importName} not found, ignoring dynamicRoute: "${route.path}"`,
        );
      }
      return acc;
    }, []);

    const entityTabOverrides = entityTabs.reduce<EntityTabOverrides>(
      (acc, { path, title, mountPoint, scope }) => {
        if (acc[path]) {
          // eslint-disable-next-line no-console
          console.warn(
            `Plugin ${scope} is not configured properly: a tab has already been configured for "${path}", ignoring entry with title: "${title}" and mountPoint: "${mountPoint}"`,
          );
        } else {
          acc[path] = { title, mountPoint };
        }
        return acc;
      },
      {},
    );

    const scaffolderFieldExtensionComponents = scaffolderFieldExtensions.reduce<
      ScaffolderFieldExtension[]
    >((acc, { scope, module, importName }) => {
      const extensionComponent = allPlugins[scope]?.[module]?.[importName];
      if (extensionComponent) {
        acc.push({
          scope,
          module,
          importName,
          Component: extensionComponent as React.ComponentType<unknown>,
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring scaffolderFieldExtension: ${importName}`,
        );
      }
      return acc;
    }, []);

    const dynamicThemeProviders = pluginThemes.reduce<AppThemeProvider[]>(
      (acc, { scope, module, importName, icon, ...rest }) => {
        const provider = allPlugins[scope]?.[module]?.[importName];
        if (provider) {
          acc.push({
            ...rest,
            icon: <MenuIcon icon={icon} />,
            Provider: provider as (props: {
              children: React.ReactNode;
            }) => JSX.Element | null,
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring theme: ${importName}`,
          );
        }
        return acc;
      },
      [],
    );

    if (!app.current) {
      const filteredStaticThemes = themes.filter(
        theme =>
          !dynamicThemeProviders.some(
            dynamicTheme => dynamicTheme.id === theme.id,
          ),
      );
      const filteredStaticApis = staticApis.filter(
        api => !remoteApis.some(remoteApi => remoteApi.api.id === api.api.id),
      );
      app.current = createApp({
        apis: [...filteredStaticApis, ...remoteApis],
        bindRoutes({ bind }) {
          bindAppRoutes(bind, resolvedRouteBindingTargets, routeBindings);
        },
        icons,
        plugins: [
          ...Object.values(staticPluginStore).map(entry => entry.plugin),
          ...remoteBackstagePlugins,
        ],
        themes: [...filteredStaticThemes, ...dynamicThemeProviders],
        components: defaultAppComponents,
      });
    }

    const dynamicRoutesMenuItems = Object.values(menuItems);

    // make the dynamic UI configuration available via Scalprum if possible
    const dynamicRootConfig = scalprumApi ? scalprumApi.dynamicRootConfig : {};
    dynamicRootConfig.dynamicRoutes = dynamicRoutesComponents;
    dynamicRootConfig.menuItems = dynamicRoutesMenuItems;
    dynamicRootConfig.entityTabOverrides = entityTabOverrides;
    dynamicRootConfig.mountPoints = mountPointComponents;
    dynamicRootConfig.scaffolderFieldExtensions =
      scaffolderFieldExtensionComponents;

    // make the dynamic UI configuration available to DynamicRootContext consumers
    setComponents({
      AppProvider: app.current.getProvider(),
      AppRouter: app.current.getRouter(),
      dynamicRoutes: dynamicRoutesComponents,
      menuItems: dynamicRoutesMenuItems,
      entityTabOverrides,
      mountPoints: mountPointComponents,
      scaffolderFieldExtensions: scaffolderFieldExtensionComponents,
    });

    afterInit().then(({ default: Component }) => {
      setChildComponent(() => Component);
    });
  }, [
    afterInit,
    scalprumApi,
    dynamicPlugins,
    pluginStore,
    scalprumConfig,
    staticApis,
    staticPluginStore,
    themes,
  ]);

  useEffect(() => {
    if (initialized && !components) {
      initializeRemoteModules();
    }
  }, [initialized, components, initializeRemoteModules]);

  if (!initialized || !components) {
    return <Loader />;
  }

  return (
    <DynamicRootContext.Provider value={components}>
      {ChildComponent ? <ChildComponent /> : <Loader />}
    </DynamicRootContext.Provider>
  );
};

export default DynamicRoot;
