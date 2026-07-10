/**
 * Dynamic plugins profile — owns includes policy and enable semantics.
 *
 * Operator merge reintroduces defaults when `includes` is omitted. Plugin
 * toggles historically mixed `enabled` (YAML) and `disabled` (mutator);
 * this module normalizes on `enabled`.
 */

export interface DynamicPluginEntry {
  package: string;
  enabled?: boolean;
  disabled?: boolean;
  pluginConfig?: unknown;
}

export interface DynamicPluginsProfile {
  includes: string[];
  plugins: DynamicPluginEntry[];
}

export type MutableDynamicPluginsConfig = {
  includes?: string[];
  plugins: DynamicPluginEntry[];
};

const HOMEPAGE_PACKAGE =
  "./dynamic-plugins/dist/red-hat-developer-hub-backstage-plugin-dynamic-home-page";

/** Force includes to [] so dynamic-plugins.default.yaml cannot load. */
export function applyDynamicPluginsProfile<T extends MutableDynamicPluginsConfig>(config: T): T {
  config.includes = [];
  return config;
}

/**
 * Enable or disable a plugin by package name.
 * Writes `enabled` and clears `disabled` so schemas cannot disagree.
 */
export function setPluginEnabled(
  config: MutableDynamicPluginsConfig,
  packageName: string,
  enabled: boolean,
): void {
  applyDynamicPluginsProfile(config);

  const plugin = config.plugins.find((entry) => entry.package === packageName);
  if (plugin === undefined) {
    config.plugins = [...config.plugins, { package: packageName, enabled }];
    return;
  }

  plugin.enabled = enabled;
  delete plugin.disabled;
}

/** Runtime operator path: homepage only, no default includes. */
export function createRuntimeDynamicPluginsProfile(): DynamicPluginsProfile {
  return {
    includes: [],
    plugins: [
      {
        package: HOMEPAGE_PACKAGE,
        enabled: true,
        pluginConfig: {
          dynamicPlugins: {
            frontend: {
              "red-hat-developer-hub.backstage-plugin-dynamic-home-page": {
                dynamicRoutes: [{ path: "/", importName: "DynamicHomePage" }],
              },
            },
          },
        },
      },
    ],
  };
}
