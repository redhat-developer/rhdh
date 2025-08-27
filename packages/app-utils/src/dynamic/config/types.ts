export type RouteBinding = {
  bindTarget: string;
  bindMap: {
    [target: string]: string;
  };
};

export type DynamicModuleEntry = {
  scope: string;
  module: string;
};

export type DynamicRouteMenuItem =
  | {
      text: string;
      icon: string;
      parent?: string;
      priority?: number;
      enabled?: boolean;
    }
  | {
      module?: string;
      importName: string;
      config?: {
        props?: Record<string, any>;
      };
    };

export type MenuItemConfig = {
  icon?: string;
  title?: string;
  priority?: number;
  parent?: string;
};

export type MenuItem = {
  name: string;
  title: string;
  icon: string;
  children: MenuItem[];
  priority?: number;
  to?: string;
  parent?: string;
  enabled?: boolean;
};

export type DynamicRoute = {
  scope: string;
  module: string;
  importName: string;
  path: string;
  menuItem?: DynamicRouteMenuItem;
  config?: {
    props?: Record<string, any>;
  };
};

export type PluginModule = DynamicModuleEntry;

export type MountPointConfigBase = {
  layout?: Record<string, string>;
  props?: Record<string, any>;
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

export type MountPoint = DynamicModuleEntry & {
  mountPoint: string;
  importName: string;
  config?: MountPointConfigRaw;
};

export type AppIcon = DynamicModuleEntry & {
  name: string;
  importName: string;
};

export type BindingTarget = DynamicModuleEntry & {
  name: string;
  importName: string;
};

export type ApiFactory = DynamicModuleEntry & {
  importName: string;
};

export type AnalyticsApiExtension = DynamicModuleEntry & {
  importName: string;
};

export type ScaffolderFieldExtension = DynamicModuleEntry & {
  importName: string;
};

export type TechdocsAddon = DynamicModuleEntry & {
  importName: string;
  config?: {
    props?: Record<string, any>;
  };
};

export type EntityTab = {
  mountPoint: string;
  path: string;
  title: string;
  pariority?: number;
};

export type EntityTabEntry = {
  scope: string;
  mountPoint: string;
  path: string;
  title: string;
  priority?: number;
};

export type ThemeEntry = DynamicModuleEntry & {
  id: string;
  title: string;
  variant: 'light' | 'dark';
  icon: string;
  importName: string;
};

export type SignInPageEntry = DynamicModuleEntry & {
  importName: string;
};

export type ProviderSetting = {
  title: string;
  description: string;
  provider: string;
};

export type CustomProperties = {
  pluginModule?: string;
  dynamicRoutes?: {
    importName?: string;
    module?: string;
    scope?: string;
    path: string;
    menuItem?: DynamicRouteMenuItem;
  }[];
  menuItems?: { [key: string]: MenuItemConfig };
  routeBindings?: {
    targets: BindingTarget[];
    bindings: RouteBinding[];
  };
  entityTabs?: EntityTab[];
  mountPoints?: MountPoint[];
  appIcons?: AppIcon[];
  apiFactories?: ApiFactory[];
  analyticsApiExtensions?: AnalyticsApiExtension[];
  providerSettings?: ProviderSetting[];
  scaffolderFieldExtensions?: ScaffolderFieldExtension[];
  signInPage: SignInPageEntry;
  techdocsAddons?: TechdocsAddon[];
  themes?: ThemeEntry[];
};

export type FrontendConfig = {
  [key: string]: CustomProperties;
};

export type DynamicPluginConfig = {
  frontend?: FrontendConfig;
};

export type DynamicConfig = {
  pluginModules: PluginModule[];
  apiFactories: ApiFactory[];
  analyticsApiExtensions: AnalyticsApiExtension[];
  appIcons: AppIcon[];
  dynamicRoutes: DynamicRoute[];
  menuItems: MenuItem[];
  entityTabs: EntityTabEntry[];
  mountPoints: MountPoint[];
  providerSettings: ProviderSetting[];
  routeBindings: RouteBinding[];
  routeBindingTargets: BindingTarget[];
  scaffolderFieldExtensions: ScaffolderFieldExtension[];
  signInPages: SignInPageEntry[];
  techdocsAddons: TechdocsAddon[];
  themes: ThemeEntry[];
};
