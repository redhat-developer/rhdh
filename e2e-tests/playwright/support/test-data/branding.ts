/**
 * Branding values set in the CI ConfigMap
 * (.ci/pipelines/resources/config_map/app-config-rhdh.yaml) and mirrored in the
 * cluster-free overlay (app-config.local-e2e.yaml). The title is deliberately not
 * the product default, so a shell that ignores app.title fails the assertions.
 */
export const APP_TITLE = "RHDH QE Instance";

/** app.branding.theme.<variant>.palette.rhdh.general.sidebarItemSelectedBackgroundColor */
export const SIDEBAR_ITEM_SELECTED_BACKGROUND = {
  light: "#f0f0f0",
  dark: "#333333",
} as const;
