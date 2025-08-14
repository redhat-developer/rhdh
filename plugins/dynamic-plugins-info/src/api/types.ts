import { createApiRef } from '@backstage/core-plugin-api';

export type DynamicPluginInfo = {
  name: string;
  version: string;
  role: string;
  platform: string;
  enabled: boolean;
  internal: boolean;
};

export interface DynamicPluginsInfoApi {
  listLoadedPlugins(): Promise<DynamicPluginInfo[]>;
}

export const dynamicPluginsInfoApiRef = createApiRef<DynamicPluginsInfoApi>({
  id: 'plugin.dynamic-plugins-info',
});
