import { createFrontendModule } from "@backstage/frontend-plugin-api";
import { SidebarContent } from "./Sidebar";

/**
 * RHDH-branded sidebar (logo, search, menu ordering, drawer toggle, settings).
 * Overrides the upstream `nav-content:app` extension.
 *
 * This module is intentionally kept local to `app` rather than
 * upstreamed to `rhdh-plugins/workspaces/app-defaults`. See
 * docs/adr/0001-app-next-sidebar-module-location.md for the rationale and
 * the future-upstream follow-up.
 */
export const navModule = createFrontendModule({
  pluginId: "app",
  extensions: [SidebarContent],
});
