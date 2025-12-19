import { test, expect } from "@playwright/test";
import { Analytics } from "../../../utils/analytics/analytics";
import { APIHelper } from "../../../utils/api-helper";

test.describe('Check "analytics-provider-segment" plugin is disabled', () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "monitoring",
    });
  });

  test('Check "analytics-provider-segment" plugin is disabled', async () => {
    const analytics = new Analytics();
    const api = new APIHelper();

    // This test uses the Guest token to check the loaded plugins.
    // Static token is not allowed to list the plugins.
    // If this breaks, we can use RhdhAuthApiHack to get the User token.
    const authHeader = await api.getGuestAuthHeader();
    const pluginsList = await analytics.getLoadedDynamicPluginsList(authHeader);
    const isPluginListed = analytics.checkPluginListed(
      pluginsList,
      "backstage-community-plugin-analytics-provider-segment",
    );

    expect(isPluginListed).toBe(false);
  });
});
