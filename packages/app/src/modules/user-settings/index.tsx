import {
  createFrontendModule,
  SubPageBlueprint,
} from "@backstage/frontend-plugin-api";

/**
 * Overrides the upstream `sub-page:user-settings/general` extension to add
 * the RHDH build-metadata `InfoCard` alongside the default profile,
 * appearance, and identity cards.
 *
 * Note: The `@backstage/plugin-user-settings` plugin itself is decoupled and NOT
 * included in the core app bundle (loaded dynamically via OCI). This local module
 * only customizes the General sub-page extension layout.
 */
const userSettingsGeneral = SubPageBlueprint.make({
  name: "general",
  params: {
    path: "general",
    title: "General",
    loader: () => import("./GeneralPage").then((m) => <m.GeneralPage />),
  },
});

export const userSettingsGeneralModule = createFrontendModule({
  pluginId: "user-settings",
  extensions: [userSettingsGeneral],
});
