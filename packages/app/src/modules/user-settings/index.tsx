import {
  createFrontendModule,
  SubPageBlueprint,
} from '@backstage/frontend-plugin-api';

/**
 * Overrides the upstream `sub-page:user-settings/general` extension to add
 * the RHDH build-metadata `InfoCard` alongside the default profile,
 * appearance, and identity cards.
 *
 * This module is intentionally kept local to `app` rather than upstreamed,
 * since upstream NFS does not currently expose card slots on the General
 * settings sub-page. See docs/adr/0001-app-next-sidebar-module-location.md
 * for the equivalent rationale applied to the nav module.
 */
const userSettingsGeneral = SubPageBlueprint.make({
  name: 'general',
  params: {
    path: 'general',
    title: 'General',
    loader: () => import('./GeneralPage').then(m => <m.GeneralPage />),
  },
});

export const userSettingsGeneralModule = createFrontendModule({
  pluginId: 'user-settings',
  extensions: [userSettingsGeneral],
});
