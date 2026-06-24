import { expect, request } from "@playwright/test";

export class Analytics {
  async getLoadedDynamicPluginsList(authHeader: { [key: string]: string }) {
    const context = await request.newContext();
    const loadedPluginsEndpoint = "/api/dynamic-plugins-info/loaded-plugins";

    let plugins: { name: string }[] | undefined;
    await expect(async () => {
      const response = await context.get(loadedPluginsEndpoint, {
        headers: authHeader,
      });
      expect(response.status()).toBe(200);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        throw new Error("Expected loaded plugins response to be an array");
      }
      plugins = body.filter(
        (item): item is { name: string } =>
          typeof item === "object" &&
          item !== null &&
          "name" in item &&
          typeof Reflect.get(item, "name") === "string",
      );
    }).toPass({
      intervals: [1_000],
      timeout: 10_000,
    });
    return plugins ?? [];
  }

  checkPluginListed(plugins: { name: string }[], expected: string) {
    return plugins.some((plugin) => plugin.name === expected);
  }
}
