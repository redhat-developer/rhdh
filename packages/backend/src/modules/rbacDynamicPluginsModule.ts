import {
  DynamicPluginManager,
  dynamicPluginsServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import {
  createBackendModule,
  createServiceFactory,
  createServiceRef,
} from '@backstage/backend-plugin-api';

import { PluginIdProvider } from '@backstage-community/plugin-rbac-backend';
import { pluginIdProviderExtensionPoint } from '@backstage-community/plugin-rbac-node';

const pluginIDProviderServiceRef = createServiceRef<PluginIdProvider>({
  id: 'pluginIDProvider',
  scope: 'root',
});

/*
// When (if ?) the BackendFeatureRegistrationObserver addition is accected / merged upstream
// (https://github.com/backstage/backstage/pull/22637),
// then the following commented code would be the right one.

class PluginIdProviderImpl extends BackendFeatureRegistrationObserver implements PluginIdProvider {
  private pluginIDs: string[] = [];

  getPluginIds = ():string[] => {
    console.log(this.pluginIDs)
    return this.pluginIDs;
  }

  setFeatures(features: BackendFeatureRegistration[]): void {
    this.pluginIDs = features.filter(f => f.type === 'plugin').map(f => f.pluginId);
    console.log(this.pluginIDs)
  }
}
*/

export const pluginIDProviderService = createServiceFactory({
  service: pluginIDProviderServiceRef,
  deps: {
    dynamicPlugins: dynamicPluginsServiceRef, // to remove when the above commented code would be used
  },
  factory({ dynamicPlugins }) {
    const backendPluginIds = (
      dynamicPlugins as DynamicPluginManager
    ).availablePackages
      .filter(p => {
        return p.manifest?.backstage?.role === 'backend-plugin';
      })
      .map(p => {
        const removedPrefix = p.manifest.name.replace(
          /(^@[^\/]*\/plugin-|^[^@/]*-plugin-)/,
          '',
        );
        const removedSuffix = removedPrefix.replace(/-backend-dynamic$/, '');
        return removedSuffix;
      });

    return {
      getPluginIds: () => {
        return ['catalog', 'scaffolder', 'permission', ...backendPluginIds];
      },
    };

    // return new PluginIdProviderImpl()
  },
});

export const rbacDynamicPluginsProvider = createBackendModule({
  pluginId: 'permission',
  moduleId: 'rbac.dynamic-plugin-ids',
  register(reg) {
    reg.registerInit({
      deps: {
        pluginIDProvider: pluginIDProviderServiceRef,
        pluginProviderIDExtension: pluginIdProviderExtensionPoint,
      },
      async init({ pluginIDProvider, pluginProviderIDExtension }) {
        pluginProviderIDExtension.addPluginIdProvider({
          getPluginIds: pluginIDProvider.getPluginIds,
        });
      },
    });
  },
});
