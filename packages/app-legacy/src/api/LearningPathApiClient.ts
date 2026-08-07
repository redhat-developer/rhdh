import {
  ConfigApi,
  createApiRef,
  DiscoveryApi,
  IdentityApi,
} from '@backstage/core-plugin-api';

import { LearningPathLink } from '../types/types';

const DEFAULT_PROXY_PATH = '/developer-hub';

export interface LearningPathApi {
  getLearningPathData(): Promise<LearningPathLink[]>;
}

export const learningPathApiRef = createApiRef<LearningPathApi>({
  id: 'app.developer-hub.learning-path.service',
});

export type Options = {
  discoveryApi: DiscoveryApi;
  configApi: ConfigApi;
  identityApi: IdentityApi;
};

export class LearningPathApiClient implements LearningPathApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly configApi: ConfigApi;
  private readonly identityApi: IdentityApi;

  constructor(options: Options) {
    this.discoveryApi = options.discoveryApi;
    this.configApi = options.configApi;
    this.identityApi = options.identityApi;
  }

  private async getBaseUrl() {
    const proxyPath =
      this.configApi.getOptionalString('developerHub.proxyPath') ??
      DEFAULT_PROXY_PATH;
    return `${await this.discoveryApi.getBaseUrl('proxy')}${proxyPath}`;
  }

  private async fetcher(url: string) {
    const { token: idToken } = await this.identityApi.getCredentials();
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(idToken && { Authorization: `Bearer ${idToken}` }),
      },
    });
    if (!response.ok) {
      throw new Error(
        `failed to fetch data, status ${response.status}: ${response.statusText}`,
      );
    }
    return await response.json();
  }

  async getLearningPathData() {
    const proxyUrl = await this.getBaseUrl();
    const data = await this.fetcher(`${proxyUrl}/learning-paths`);
    return data;
  }
}
