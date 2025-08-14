import { expect, request } from "@playwright/test";

export class Analytics {
  async getLoadedDynamicPluginsList(authHeader: { [key: string]: string }) {
    const context = await request.newContext();
    const loadedPluginsEndpoint = "/api/dynamic-plugins-info/loaded-plugins";
    const response = await context.get(loadedPluginsEndpoint, {
      headers: authHeader,
    });
    expect(response.status()).toBe(200);
    const plugins = await response.json();
    return plugins;
  }

  checkPluginListed(plugins: { name: string }[], expected: string) {
    return plugins.some((plugin) => plugin.name === expected);
  }
}
