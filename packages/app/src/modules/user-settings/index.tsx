import {
  createFrontendModule,
  SubPageBlueprint,
} from "@backstage/frontend-plugin-api";

/**
 * Overrides the upstream `sub-page:user-settings/general` extension to add
 * the RHDH build-metadata `InfoCard` alongside the default profile,
 * appearance, and identity cards.
 *
 * This module is intentionally kept local to `app` rather than upstreamed,
 * since upstream NFS does not currently expose card slots on the General
 * settings sub-page.
 */
const generalSettingsPage = SubPageBlueprint.make({
  name: "general",
  params: {
    path: "general",
    title: "General",
    loader: async () => {
      const [m, { Content }] = await Promise.all([
        import('./GeneralPage'),
        import('@backstage/core-components'),
      ]);
      return (
        <Content>
          <m.GeneralPage />
        </Content>
      );
    },
  },
});

export const userSettingsGeneralModule = createFrontendModule({
  pluginId: "user-settings",
  extensions: [generalSettingsPage],
});
