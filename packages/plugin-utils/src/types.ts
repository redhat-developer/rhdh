import { Entity } from '@backstage/catalog-model';
import { TranslationRef } from '@backstage/core-plugin-api/alpha';

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

export type MountPointConfigBase = {
  id?: string;
  layout?: Record<string, string>;
  props?: Record<string, any>;
};

export type MountPointConfig = MountPointConfigBase & {
  if: (e: Entity) => boolean;
};

export type MountPointConfigRawIf = {
  [key in 'allOf' | 'oneOf' | 'anyOf']?: (
    | {
        [key: string]: string | string[];
      }
    | Function
  )[];
};

export type MountPointConfigRaw = MountPointConfigBase & {
  if?: MountPointConfigRawIf;
};

export type MountPoint = {
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

export type MountPoints = Record<string, MountPoint[]>;

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

export type ProviderSetting = {
  title: string;
  description: string;
  provider: string;
};

/**
 * Configuration for a custom catalog table column
 */
export type CustomColumnConfig = {
  /** The column header title */
  title: string;
  /** The entity field path to display (e.g., "metadata.annotations['custom/field']" or "spec.team") */
  field: string;
  /** Optional column width in pixels */
  width?: number;
  /** Whether the column should be sortable */
  sortable?: boolean;
  /** Default value to display when the field is empty or undefined */
  defaultValue?: string;
  /** Optional entity kind(s) to apply this column to. If not specified, applies to all kinds. */
  kind?: string | string[];
};

/**
 * Configuration for catalog table columns
 */
export type CatalogColumnConfig = {
  /** List of column IDs to include. When specified, only these columns will be shown. */
  include?: string[];
  /** List of column IDs to exclude from the default columns. */
  exclude?: string[];
  /** Custom columns to add to the catalog table */
  custom?: CustomColumnConfig[];
};

export type DynamicRootConfig = {
  dynamicRoutes: ResolvedDynamicRoute[];
  entityTabOverrides: EntityTabOverrides;
  mountPoints: MountPoints;
  menuItems: ResolvedMenuItem[];
  providerSettings: ProviderSetting[];
  scaffolderFieldExtensions: ScaffolderFieldExtension[];
  techdocsAddons: TechdocsAddon[];
  translationRefs: TranslationRef[];
  catalogTableColumns?: CatalogColumnConfig;
};

export type ComponentRegistry = {
  AppProvider: React.ComponentType<React.PropsWithChildren>;
  AppRouter: React.ComponentType<React.PropsWithChildren>;
} & DynamicRootConfig;
