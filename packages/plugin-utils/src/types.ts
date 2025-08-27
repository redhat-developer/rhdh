import { Entity } from '@backstage/catalog-model';

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
  { title: string; mountPoint: string; priority?: number }
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
};

export type ComponentRegistry = {
  AppProvider: React.ComponentType<React.PropsWithChildren>;
  AppRouter: React.ComponentType<React.PropsWithChildren>;
} & DynamicRootConfig;
