import { extractMenuItems } from './extractDynamicConfigFrontend';
import {
  AnalyticsApiExtension,
  ApiFactory,
  AppIcon,
  BindingTarget,
  DynamicConfig,
  DynamicModuleEntry,
  DynamicPluginConfig,
  DynamicRoute,
  DynamicTranslationResource,
  EntityTabEntry,
  MountPoint,
  ProviderSetting,
  RouteBinding,
  ScaffolderFieldExtension,
  SignInPageEntry,
  TechdocsAddon,
  ThemeEntry,
} from './types';

/**
 * Converts the dynamic plugin configuration structure to the data structure
 * required by the dynamic UI, substituting in any defaults as needed
 */
export function extractDynamicConfig(dynamicPlugins: DynamicPluginConfig) {
  const config: DynamicConfig = {
    pluginModules: [],
    apiFactories: [],
    analyticsApiExtensions: [],
    appIcons: [],
    dynamicRoutes: [],
    menuItems: [],
    entityTabs: [],
    mountPoints: [],
    routeBindings: [],
    routeBindingTargets: [],
    providerSettings: [],
    scaffolderFieldExtensions: [],
    signInPages: [],
    techdocsAddons: [],
    themes: [],
    translationResources: [],
  };
  if (dynamicPlugins?.frontend === undefined) {
    return config;
  }
  const { frontend } = dynamicPlugins;
  config.signInPages = Object.entries(frontend).reduce<SignInPageEntry[]>(
    (pluginSet, [scope, { signInPage }]) => {
      if (!signInPage) {
        return pluginSet;
      }
      const { importName, module } = signInPage;
      if (!importName) {
        return pluginSet;
      }
      pluginSet.push({
        scope,
        module: module ?? 'PluginRoot',
        importName,
      });
      return pluginSet;
    },
    [],
  );
  config.pluginModules = Object.entries(frontend).reduce<DynamicModuleEntry[]>(
    (pluginSet, [scope, customProperties]) => {
      pluginSet.push({
        scope,
        module: customProperties.pluginModule ?? 'PluginRoot',
      });
      return pluginSet;
    },
    [],
  );
  config.dynamicRoutes = Object.entries(frontend).reduce<DynamicRoute[]>(
    (pluginSet, [scope, customProperties]) => {
      pluginSet.push(
        ...(customProperties.dynamicRoutes ?? []).map(route => ({
          ...route,
          module: route.module ?? 'PluginRoot',
          importName: route.importName ?? 'default',
          scope,
        })),
      );
      return pluginSet;
    },
    [],
  );
  config.menuItems = extractMenuItems(frontend);
  config.routeBindings = Object.entries(frontend).reduce<RouteBinding[]>(
    (pluginSet, [_, customProperties]) => {
      pluginSet.push(...(customProperties.routeBindings?.bindings ?? []));
      return pluginSet;
    },
    [],
  );
  config.routeBindingTargets = Object.entries(frontend).reduce<BindingTarget[]>(
    (pluginSet, [scope, customProperties]) => {
      pluginSet.push(
        ...(customProperties.routeBindings?.targets ?? []).map(target => ({
          ...target,
          module: target.module ?? 'PluginRoot',
          name: target.name ?? target.importName,
          scope,
        })),
      );
      return pluginSet;
    },
    [],
  );
  config.mountPoints = Object.entries(frontend).reduce<MountPoint[]>(
    (accMountPoints, [scope, { mountPoints }]) => {
      accMountPoints.push(
        ...(mountPoints ?? []).map(mountPoint => ({
          ...mountPoint,
          module: mountPoint.module ?? 'PluginRoot',
          importName: mountPoint.importName ?? 'default',
          scope,
        })),
      );
      return accMountPoints;
    },
    [],
  );
  config.appIcons = Object.entries(frontend).reduce<AppIcon[]>(
    (accAppIcons, [scope, { appIcons }]) => {
      accAppIcons.push(
        ...(appIcons ?? []).map(icon => ({
          ...icon,
          module: icon.module ?? 'PluginRoot',
          importName: icon.importName ?? 'default',
          scope,
        })),
      );
      return accAppIcons;
    },
    [],
  );
  config.apiFactories = Object.entries(frontend).reduce<ApiFactory[]>(
    (accApiFactories, [scope, { apiFactories }]) => {
      accApiFactories.push(
        ...(apiFactories ?? []).map(api => ({
          module: api.module ?? 'PluginRoot',
          importName: api.importName ?? 'default',
          scope,
        })),
      );
      return accApiFactories;
    },
    [],
  );
  config.analyticsApiExtensions = Object.entries(frontend).reduce<
    AnalyticsApiExtension[]
  >((accAnalyticsApiExtensions, [scope, { analyticsApiExtensions }]) => {
    accAnalyticsApiExtensions.push(
      ...(analyticsApiExtensions ?? []).map(analyticsApi => ({
        module: analyticsApi.module ?? 'PluginRoot',
        importName: analyticsApi.importName ?? 'default',
        scope,
      })),
    );
    return accAnalyticsApiExtensions;
  }, []);
  config.scaffolderFieldExtensions = Object.entries(frontend).reduce<
    ScaffolderFieldExtension[]
  >((accScaffolderFieldExtensions, [scope, { scaffolderFieldExtensions }]) => {
    accScaffolderFieldExtensions.push(
      ...(scaffolderFieldExtensions ?? []).map(scaffolderFieldExtension => ({
        module: scaffolderFieldExtension.module ?? 'PluginRoot',
        importName: scaffolderFieldExtension.importName ?? 'default',
        scope,
      })),
    );
    return accScaffolderFieldExtensions;
  }, []);
  config.techdocsAddons = Object.entries(frontend).reduce<TechdocsAddon[]>(
    (accTechdocsAddons, [scope, { techdocsAddons }]) => {
      accTechdocsAddons.push(
        ...(techdocsAddons ?? []).map(techdocsAddon => ({
          ...techdocsAddon,
          module: techdocsAddon.module ?? 'PluginRoot',
          importName: techdocsAddon.importName ?? 'default',
          scope,
        })),
      );
      return accTechdocsAddons;
    },
    [],
  );
  config.entityTabs = Object.entries(frontend).reduce<EntityTabEntry[]>(
    (accEntityTabs, [scope, { entityTabs }]) => {
      accEntityTabs.push(
        ...(entityTabs ?? []).map(entityTab => ({
          ...entityTab,
          scope,
        })),
      );
      return accEntityTabs;
    },
    [],
  );
  config.themes = Object.entries(frontend).reduce<ThemeEntry[]>(
    (accThemeEntries, [scope, { themes }]) => {
      accThemeEntries.push(
        ...(themes ?? []).map(theme => ({
          ...theme,
          module: theme.module ?? 'PluginRoot',
          scope,
        })),
      );
      return accThemeEntries;
    },
    [],
  );
  config.providerSettings = Object.entries(frontend).reduce<ProviderSetting[]>(
    (accProviderSettings, [_, { providerSettings = [] }]) => {
      return [...accProviderSettings, ...providerSettings];
    },
    [],
  );

  config.translationResources = Object.entries(frontend).reduce<
    DynamicTranslationResource[]
  >((accTranslationResources, [scope, { translationResources }]) => {
    accTranslationResources.push(
      ...(translationResources ?? []).map(resource => ({
        ...resource,
        module: resource.module ?? 'PluginRoot',
        importName: resource.importName ?? 'default',
        ref: resource.ref ?? null,
        jsonTranslations: resource.jsonTranslations ?? [],
        scope,
      })),
    );
    return accTranslationResources;
  }, []);

  return config;
}
