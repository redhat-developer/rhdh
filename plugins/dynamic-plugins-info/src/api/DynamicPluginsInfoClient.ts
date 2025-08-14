import {
  DiscoveryApi,
  FetchApi,
  IdentityApi,
} from '@backstage/core-plugin-api';

import { DynamicPluginInfo, DynamicPluginsInfoApi } from './types';

export interface DynamicPluginsInfoClientOptions {
  discoveryApi: DiscoveryApi;
  fetchApi: FetchApi;
  identityApi: IdentityApi;
}

const loadedPluginsEndpoint = '/loaded-plugins';

export class DynamicPluginsInfoClient implements DynamicPluginsInfoApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;
  private readonly identityApi: IdentityApi;

  constructor(options: DynamicPluginsInfoClientOptions) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
    this.identityApi = options.identityApi;
  }
  async listLoadedPlugins(): Promise<DynamicPluginInfo[]> {
    const baseUrl = await this.discoveryApi.getBaseUrl('dynamic-plugins-info');
    const targetUrl = `${baseUrl}${loadedPluginsEndpoint}`;
    const { token } = await this.identityApi.getCredentials();
    const response = await this.fetchApi.fetch(targetUrl, {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data.error?.message || data.message || data.toString?.();
      throw new Error(`Failed to load dynamic plugin info: ${message}`);
    }
    return data;
  }
}
