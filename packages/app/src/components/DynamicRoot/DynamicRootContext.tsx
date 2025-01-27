import React, { createContext } from 'react';

import { Entity } from '@backstage/catalog-model';
import {
  AnyApiFactory,
  AppTheme,
  BackstagePlugin,
} from '@backstage/core-plugin-api';

import { ScalprumComponentProps } from '@scalprum/react-core';

export type RouteBinding = {
  bindTarget: string;
  bindMap: {
    [target: string]: string;
  };
};

export type ResolvedDynamicRouteMenuItem =
  | {
      text: string;
      icon: string;
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
};

export type DynamicModuleEntry = Pick<
  ScalprumComponentProps,
  'scope' | 'module'
>;

export type ResolvedDynamicRoute = DynamicModuleEntry & {
  path: string;
  importName: string;
  menuItem?: ResolvedDynamicRouteMenuItem;
  Component: React.ComponentType<any>;
  staticJSXContent?:
    | React.ReactNode
    | ((dynamicRootConfig: DynamicRootConfig) => React.ReactNode);
  config: {
    props?: Record<string, any>;
  };
};

type ScalprumMountPointConfigBase = {
  layout?: Record<string, string>;
  props?: Record<string, any>;
};

export type ScalprumMountPointConfig = ScalprumMountPointConfigBase & {
  if: (e: Entity) => boolean;
};

export type ScalprumMountPointConfigRawIf = {
  [key in 'allOf' | 'oneOf' | 'anyOf']?: (
    | {
        [key: string]: string | string[];
      }
    | Function
  )[];
};

export type ScalprumMountPointConfigRaw = ScalprumMountPointConfigBase & {
  if?: ScalprumMountPointConfigRawIf;
};

export type ScalprumMountPoint = {
  Component: React.ComponentType<React.PropsWithChildren>;
  config?: ScalprumMountPointConfig;
  importName?: string;
  staticJSXContent?:
    | React.ReactNode
    | ((config: DynamicRootConfig) => React.ReactNode);
};

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
        | AnyApiFactory;
    };
  };
};

export type EntityTabOverrides = Record<
  string,
  { title: string; mountPoint: string }
>;

export type MountPoints = Record<string, ScalprumMountPoint[]>;

export type AppThemeProvider = Partial<AppTheme> & Omit<AppTheme, 'theme'>;

export type ScaffolderFieldExtension = {
  scope: string;
  module: string;
  importName: string;
  Component: React.ComponentType<{}>;
};

export type TechdocsAddon = {
  scope: string;
  module: string;
  importName: string;
  Component: React.ComponentType<{}>;
  config: {
    props?: Record<string, any>;
  };
};

export type DynamicRootConfig = {
  dynamicRoutes: ResolvedDynamicRoute[];
  entityTabOverrides: EntityTabOverrides;
  mountPoints: MountPoints;
  menuItems: ResolvedMenuItem[];
  scaffolderFieldExtensions: ScaffolderFieldExtension[];
  techdocsAddons: TechdocsAddon[];
};

export type ComponentRegistry = {
  AppProvider: React.ComponentType<React.PropsWithChildren>;
  AppRouter: React.ComponentType<React.PropsWithChildren>;
} & DynamicRootConfig;

const DynamicRootContext = createContext<ComponentRegistry>({
  AppProvider: () => null,
  AppRouter: () => null,
  dynamicRoutes: [],
  entityTabOverrides: {},
  mountPoints: {},
  menuItems: [],
  scaffolderFieldExtensions: [],
  techdocsAddons: [],
});

export default DynamicRootContext;
