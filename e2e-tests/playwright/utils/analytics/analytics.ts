import { expect, request } from "@playwright/test";

export class Analytics {
  async getLoadedDynamicPluginsList(authHeader: { [key: string]: string }) {
    const context = await request.newContext();
    const loadedPluginsEndpoint = "/api/dynamic-plugins-info/loaded-plugins";

    let plugins;
    await expect(async () => {
      const response = await context.get(loadedPluginsEndpoint, {
        headers: authHeader,
      });
      expect(response.status()).toBe(200);
      plugins = await response.json();
    }).toPass({
      intervals: [1_000],
      timeout: 10_000,
    });
    return plugins;
  }

  checkPluginListed(plugins: { name: string }[], expected: string) {
    return plugins.some((plugin) => plugin.name === expected);
  }
}
