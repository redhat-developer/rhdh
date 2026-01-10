import { Entity } from '@backstage/catalog-model';
import {
  AnalyticsApi,
  AnyApiFactory,
  AppTheme,
  BackstagePlugin,
  ConfigApi,
  IdentityApi,
} from '@backstage/core-plugin-api';
import { TranslationRef } from '@backstage/core-plugin-api/alpha';

export type RemotePlugins = {
  [scope: string]: {
    [module: string]: {
      [importName: string]:
        | React.ComponentType<React.PropsWithChildren>
        | ((...args: any[]) => any)
        | BackstagePlugin<{}>
        | {
            element: React.ComponentType<React.PropsWithChildren>;
            staticJSXContent:
              | React.ReactNode
              | ((config: DynamicRootConfig) => React.ReactNode);
          }
        | AnyApiFactory
        | AnalyticsApiClass;
    };
  };
};

export type AnalyticsApiClass = {
  fromConfig(
    config: ConfigApi,
    deps: { identityApi: IdentityApi },
  ): AnalyticsApi;
};

export type AppThemeProvider = Partial<AppTheme> & Omit<AppTheme, 'theme'>;

export type StaticPlugins = Record<
  string,
  {
    plugin: BackstagePlugin;
    module:
      | React.ComponentType<any>
      | { [importName: string]: React.ComponentType<any> };
  }
>;

export type ResolvedDynamicRouteMenuItem =
  | {
      text: string;
      icon: string;
      enabled?: boolean;
    }
  | {
      Component: React.ComponentType<any>;
      config: {
        props?: Record<string, any>;
      };
    };

export type ResolvedMenuItem = {
  name: string;
  title: string;
  titleKey?: string;
  icon?: string;
  children?: ResolvedMenuItem[];
  to?: string;
  priority?: number;
  enabled?: boolean;
};

export type ResolvedDynamicRoute = {
  scope: string;
  module: string;
  path: string;
  menuItem?: ResolvedDynamicRouteMenuItem;
  Component: React.ComponentType<any>;
  staticJSXContent?:
    | React.ReactNode
    | ((dynamicRootConfig: DynamicRootConfig) => React.ReactNode);
  config: {
    props?: Record<string, any>;
  };
};

export type MountPointConfig = {
  layout?: Record<string, string>;
  if: (e: Entity) => boolean;
  props?: Record<string, any>;
};

export type ResolvedMountPoint = {
  Component: React.ComponentType<React.PropsWithChildren>;
  config?: MountPointConfig;
  staticJSXContent?:
    | React.ReactNode
    | ((config: DynamicRootConfig) => React.ReactNode);
};

export type EntityTabOverrides = Record<
  string,
  { title: string; titleKey?: string; mountPoint: string; priority?: number }
>;

export type MountPoints = Record<string, ResolvedMountPoint[]>;

export type ResolvedScaffolderFieldExtension = {
  scope: string;
  module: string;
  importName: string;
  Component: React.ComponentType<{}>;
};

export type ResolvedTechdocsAddon = {
  scope: string;
  module: string;
  importName: string;
  Component: React.ComponentType<{}>;
  config: {
    props?: Record<string, any>;
  };
};

export type ResolvedProviderSetting = {
  title: string;
  description: string;
  provider: string;
};

export type DynamicRootConfig = {
  dynamicRoutes: ResolvedDynamicRoute[];
  entityTabOverrides: EntityTabOverrides;
  mountPoints: MountPoints;
  menuItems: ResolvedMenuItem[];
  providerSettings: ResolvedProviderSetting[];
  scaffolderFieldExtensions: ResolvedScaffolderFieldExtension[];
  techdocsAddons: ResolvedTechdocsAddon[];
  translationRefs: TranslationRef[];
};

export type ComponentRegistry = {
  AppProvider: React.ComponentType<React.PropsWithChildren>;
  AppRouter: React.ComponentType<React.PropsWithChildren>;
} & DynamicRootConfig;
