import { test, expect } from "@playwright/test";
import { Analytics } from "../../../utils/analytics/analytics";
import { APIHelper } from "../../../utils/api-helper";

test('Check "analytics-provider-segment" plugin is enabled', async () => {
  const analytics = new Analytics();
  const api = new APIHelper();

  const authHeader = await api.getGuestAuthHeader();
  const pluginsList = await analytics.getLoadedDynamicPluginsList(authHeader);
  const isPluginListed = analytics.checkPluginListed(
    pluginsList,
    "backstage-community-plugin-analytics-provider-segment",
  );

  expect(isPluginListed).toBe(true);
});
