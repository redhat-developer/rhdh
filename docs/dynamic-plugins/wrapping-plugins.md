# Wrapping a third-party backend plugin to add dynamic plugin support

Unless you need to include plugin in the default RHDH container image, or you need to make some changes in the plugin source code, you don't need to wrap the plugin.
You can just [export](export-derived-package.md) plugin as a dynamic plugin and install it as described in the [Installing External Dynamic Plugins](installing-plugins.md#installing-external-dynamic-plugins) guide.

In order to add dynamic plugin support to a third-party backend plugin, without touching the third-party plugin source code, a wrapper plugin can be created that will:

- import the third-party plugin as a dependency.
- reexport the third-party plugin in `src/index.ts` via `export {default} from '<package_name>'`,
- export it as a dynamic plugin.

While the idea of wrapped plugins has been deprecated since RHDH 1.7, some old examples of wrapped plugins can still be found in the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers). 

These will be removed over time as they are migrated to https://github.com/redhat-developer/rhdh-plugin-export-overlays/ and replaced by OCI artifacts. 
